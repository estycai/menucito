/** Runs `task` and reports whether it succeeded, swallowing the error: for steps that may fail independently. */
export async function attempt(task: () => Promise<unknown>): Promise<boolean> {
  try {
    await task();
    return true;
  } catch {
    return false;
  }
}
