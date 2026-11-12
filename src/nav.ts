/** Rows moved by PageUp / PageDown. */
export const PAGE = 10;

/**
 * Selection after moving `delta` rows through the visible pids, clamped to the
 * ends. With nothing (or something filtered out) selected, moving down picks
 * the first row and moving up picks the last.
 */
export function stepSelection(pids: number[], selected: number | null, delta: number): number | null {
  if (pids.length === 0) return null;
  const i = selected === null ? -1 : pids.indexOf(selected);
  if (i === -1) return delta >= 0 ? pids[0] : pids[pids.length - 1];
  return pids[Math.max(0, Math.min(pids.length - 1, i + delta))];
}

export function edgeSelection(pids: number[], end: "start" | "end"): number | null {
  if (pids.length === 0) return null;
  return end === "start" ? pids[0] : pids[pids.length - 1];
}
