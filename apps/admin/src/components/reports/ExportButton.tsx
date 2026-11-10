import { Button } from "@/components/ui/button";
import { csvFileName, downloadCsv, toCsv, type CsvColumn } from "@/lib/reports";

interface ExportButtonProps<T> {
  tab: string;
  block: string;
  from: string;
  to: string;
  rows: readonly T[];
  columns: readonly CsvColumn<T>[];
}

/** Downloads the rows of a table as CSV. The permission (`stats.export`) is checked by the caller. */
export function ExportButton<T>({ tab, block, from, to, rows, columns }: ExportButtonProps<T>) {
  return (
    <Button
      type="button"
      variant="outline"
      disabled={rows.length === 0}
      onClick={() => downloadCsv(csvFileName(tab, block, from, to), toCsv(rows, columns))}
      className="min-h-11 px-3 text-xs"
    >
      Exportar CSV
    </Button>
  );
}
