export type DropTargetRect = { top: number; height: number };

export function findDropTarget(
  clientY: number,
  rects: readonly (DropTargetRect | null)[],
): number {
  for (let i = 0; i < rects.length; i++) {
    const rect = rects[i];
    if (!rect) continue;
    if (clientY < rect.top + rect.height / 2) return i;
  }
  return rects.length - 1;
}
