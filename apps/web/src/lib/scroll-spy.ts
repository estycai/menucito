/**
 * Index of the section the reader is in: the last one whose top has crossed `line` (both measured from
 * the viewport top), or the first when none has. `tops` follows document order.
 */
export function activeSectionIndex(tops: readonly number[], line: number): number {
  let active = 0;
  tops.forEach((top, index) => {
    if (top <= line) active = index;
  });
  return active;
}
