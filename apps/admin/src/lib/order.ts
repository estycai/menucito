/** `ids` with the item at `index` swapped with its neighbor (`-1` up, `+1` down). Out of range: unchanged. */
export function moveId(ids: readonly string[], index: number, direction: -1 | 1): string[] {
  const target = index + direction;
  const next = [...ids];
  if (index < 0 || index >= next.length || target < 0 || target >= next.length) return next;
  [next[index], next[target]] = [next[target] as string, next[index] as string];
  return next;
}
