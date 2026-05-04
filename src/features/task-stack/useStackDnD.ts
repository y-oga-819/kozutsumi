import {
  useCallback,
  useRef,
  useState,
  type MutableRefObject,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { findDropTarget } from "./findDropTarget";

/**
 * Drag mode (ADR-0041):
 * - `single`: 行カードの Grip 起点。1 行だけ動かす (従来挙動)
 * - `group`:  行カードの 親バッジ (`⤷ 親名`) 起点。同じ `parent_task_id` を持つ
 *             全行をグループとしてまとめて動かす
 */
export type DragMode = "single" | "group";

export type UseStackDnDResult = {
  dragIdx: number | null;
  overIdx: number | null;
  dragMode: DragMode | null;
  /** 行要素 (li or div) の ref。getBoundingClientRect しか使わないので HTMLElement で十分。 */
  rowRefs: MutableRefObject<(HTMLElement | null)[]>;
  handlePointerDown: (idx: number, e: ReactPointerEvent<HTMLElement>, mode?: DragMode) => void;
};

export function useStackDnD(
  onReorder: (from: number, to: number, mode: DragMode) => void,
): UseStackDnDResult {
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [overIdx, setOverIdx] = useState<number | null>(null);
  const [dragMode, setDragMode] = useState<DragMode | null>(null);
  const rowRefs = useRef<(HTMLElement | null)[]>([]);
  const dragIdxRef = useRef<number | null>(null);
  const overIdxRef = useRef<number | null>(null);
  const dragModeRef = useRef<DragMode | null>(null);
  const startY = useRef(0);
  const isDragging = useRef(false);

  const computeTarget = useCallback((clientY: number): number => {
    const rects = rowRefs.current.map((el) => (el ? el.getBoundingClientRect() : null));
    return findDropTarget(clientY, rects);
  }, []);

  const handlePointerDown = useCallback(
    (idx: number, e: ReactPointerEvent<HTMLElement>, mode: DragMode = "single") => {
      e.preventDefault();
      startY.current = e.clientY;
      isDragging.current = false;
      dragIdxRef.current = idx;
      overIdxRef.current = null;
      dragModeRef.current = mode;
      setDragIdx(idx);
      setOverIdx(null);
      setDragMode(mode);

      const onMove = (ev: PointerEvent) => {
        ev.preventDefault();
        const cy = ev.clientY ?? 0;
        if (!isDragging.current && Math.abs(cy - startY.current) > 5) isDragging.current = true;
        if (isDragging.current) {
          const t = computeTarget(cy);
          overIdxRef.current = t;
          setOverIdx(t);
        }
      };
      const onUp = () => {
        const from = dragIdxRef.current;
        const to = overIdxRef.current;
        const m = dragModeRef.current ?? "single";
        if (isDragging.current && from !== null && to !== null && from !== to) {
          onReorder(from, to, m);
        }
        dragIdxRef.current = null;
        overIdxRef.current = null;
        dragModeRef.current = null;
        isDragging.current = false;
        setDragIdx(null);
        setOverIdx(null);
        setDragMode(null);
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onUp);
      };
      window.addEventListener("pointermove", onMove, { passive: false });
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onUp);
    },
    [computeTarget, onReorder],
  );

  return { dragIdx, overIdx, dragMode, rowRefs, handlePointerDown };
}
