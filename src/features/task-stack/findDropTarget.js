/**
 * ドラッグ中のカーソル Y 座標から、挿入ターゲットの行インデックスを決める。
 * 各要素の上半分にいれば自身のインデックス、下半分にいれば次のインデックス。
 *
 * @param {number} clientY - カーソルの y 座標（DOMRect 座標系）
 * @param {Array<{ top: number, height: number } | null>} rects
 * @returns {number} - ターゲット行のインデックス。空なら -1
 */
export function findDropTarget(clientY, rects) {
  for (let i = 0; i < rects.length; i++) {
    const rect = rects[i];
    if (!rect) continue;
    if (clientY < rect.top + rect.height / 2) return i;
  }
  return rects.length - 1;
}
