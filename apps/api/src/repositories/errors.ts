/**
 * Raised when a write hits a UNIQUE constraint. `column` names the violated column (the first one of
 * a composite index) or, for expression indexes (e.g. `lower(name)`), the index; `columns` lists
 * every column of the violated constraint; `table` is `null` when SQLite only reports the index name.
 */
export class UniqueViolationError extends Error {
  readonly columns: readonly string[];

  constructor(
    readonly column: string,
    readonly table: string | null = null,
    columns: readonly string[] = [column],
  ) {
    super(table ? `Unique constraint failed: ${table}.${columns.join(", ")}` : `Unique constraint failed: index ${column}`);
    this.name = "UniqueViolationError";
    this.columns = columns;
  }
}

// SQLite reports `UNIQUE constraint failed: <table>.<column>[, <table>.<column>...]` for column
// constraints and `UNIQUE constraint failed: index '<name>'` for expression indexes.
const UNIQUE_FAILURE = /UNIQUE constraint failed: (?:index '([^']+)'|(\w+\.\w+(?:, \w+\.\w+)*))/;

/**
 * Walks the error cause chain (Drizzle wraps the D1 error) looking for a SQLite UNIQUE failure.
 * Returns the matching `UniqueViolationError`, or `null` when `error` is something else.
 */
export function asUniqueViolation(error: unknown): UniqueViolationError | null {
  for (let current = error; current instanceof Error; current = current.cause) {
    const match = UNIQUE_FAILURE.exec(current.message);
    if (match?.[1]) return new UniqueViolationError(match[1]);
    if (match?.[2]) {
      const qualified = match[2].split(", ").map((part) => part.split("."));
      const table = qualified[0]![0]!;
      const columns = qualified.map(([, column]) => column!);
      return new UniqueViolationError(columns[0]!, table, columns);
    }
  }
  return null;
}

/** Runs a write and translates UNIQUE failures into `UniqueViolationError`. */
export async function translatingUniqueViolations<T>(write: () => Promise<T>): Promise<T> {
  try {
    return await write();
  } catch (error) {
    throw asUniqueViolation(error) ?? error;
  }
}

/** Raised when a write hits a FOREIGN KEY constraint (e.g. deleting a category that has products). */
export class ForeignKeyViolationError extends Error {
  constructor(options?: ErrorOptions) {
    super("Foreign key constraint failed", options);
    this.name = "ForeignKeyViolationError";
  }
}

/** Runs a write and translates FOREIGN KEY failures into `ForeignKeyViolationError`. */
export async function translatingForeignKeyViolations<T>(write: () => Promise<T>): Promise<T> {
  try {
    return await write();
  } catch (error) {
    for (let current = error; current instanceof Error; current = current.cause) {
      if (current.message.includes("FOREIGN KEY constraint failed")) throw new ForeignKeyViolationError({ cause: error });
    }
    throw error;
  }
}
