import { useCallback, useRef, useState } from "react";
import { findDropTarget } from "./findDropTarget.js";

/**
 * pointer ベースのタスクスタック用 DnD hook。
 *
 * @param {(from: number, to: number) => void} onReorder - 並べ替え確定時に呼ばれる
 * @returns {{
 *   dragIdx: number | null,
 *   overIdx: number | null,
 *   rowRefs: { current: (HTMLElement | null)[] },
 *   handlePointerDown: (idx: number, event: PointerEvent) => void,
 * }}
 */
export function useStackDnD(onReorder) {
  const [dragIdx, setDragIdx] = useState(null);
  const [overIdx, setOverIdx] = useState(null);
  const rowRefs = useRef([]);
  const dragIdxRef = useRef(null);
  const overIdxRef = useRef(null);
  const startY = useRef(0);
  const isDragging = useRef(false);

  const computeTarget = useCallback((clientY) => {
    const rects = rowRefs.current.map((el) =>
      el ? el.getBoundingClientRect() : null,
    );
    return findDropTarget(clientY, rects);
  }, []);

  const handlePointerDown = useCallback(
    (idx, e) => {
      e.preventDefault();
      startY.current = e.clientY;
      isDragging.current = false;
      dragIdxRef.current = idx;
      overIdxRef.current = null;
      setDragIdx(idx);
      setOverIdx(null);

      const onMove = (ev) => {
        ev.preventDefault();
        const cy = ev.clientY ?? 0;
        if (!isDragging.current && Math.abs(cy - startY.current) > 5)
          isDragging.current = true;
        if (isDragging.current) {
          const t = computeTarget(cy);
          overIdxRef.current = t;
          setOverIdx(t);
        }
      };
      const onUp = () => {
        const from = dragIdxRef.current;
        const to = overIdxRef.current;
        if (isDragging.current && from !== null && to !== null && from !== to)
          onReorder(from, to);
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
