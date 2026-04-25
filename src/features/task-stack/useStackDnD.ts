import {
  useCallback,
  useRef,
  useState,
  type MutableRefObject,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { findDropTarget } from "./findDropTarget";

export type UseStackDnDResult = {
  dragIdx: number | null;
  overIdx: number | null;
  rowRefs: MutableRefObject<(HTMLDivElement | null)[]>;
  handlePointerDown: (idx: number, e: ReactPointerEvent<HTMLElement>) => void;
};

export function useStackDnD(onReorder: (from: number, to: number) => void): UseStackDnDResult {
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [overIdx, setOverIdx] = useState<number | null>(null);
  const rowRefs = useRef<(HTMLDivElement | null)[]>([]);
  const dragIdxRef = useRef<number | null>(null);
  const overIdxRef = useRef<number | null>(null);
  const startY = useRef(0);
  const isDragging = useRef(false);

  const computeTarget = useCallback((clientY: number): number => {
    const rects = rowRefs.current.map((el) => (el ? el.getBoundingClientRect() : null));
    return findDropTarget(clientY, rects);
  }, []);

  const handlePointerDown = useCallback(
    (idx: number, e: ReactPointerEvent<HTMLElement>) => {
      e.preventDefault();
      startY.current = e.clientY;
      isDragging.current = false;
      dragIdxRef.current = idx;
      overIdxRef.current = null;
      setDragIdx(idx);
      setOverIdx(null);

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
        if (isDragging.current && from !== null && to !== null && from !== to) onReorder(from, to);
        dragIdxRef.current = null;
        overIdxRef.current = null;
        isDragging.current = false;
        setDragIdx(null);
        setOverIdx(null);
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

  return { dragIdx, overIdx, rowRefs, handlePointerDown };
}
