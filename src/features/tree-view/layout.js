export const COL = 16;
export const GRAPH_LEFT = 12;

/**
 * プロジェクトレーン（縦線）の x 座標を返す。
 * TreeView コンテナの padding (16px) を含む絶対位置。
 */
export function laneLeftPx(projectIndex) {
  return GRAPH_LEFT + projectIndex * COL + COL / 2 - 1 + 16;
}

/**
 * タスクノードの丸印の中心 x 座標を返す。
 */
export function nodeCenterPx(projectIndex) {
  return 16 + GRAPH_LEFT + projectIndex * COL + COL / 2;
}

/**
 * プロジェクトレーン全体の横幅を返す。日付見出しやタスクラベルの左側 padding に使う。
 */
export function lanesWidthPx(projectCount) {
  return GRAPH_LEFT + COL * projectCount + 6;
}

/**
 * historyData を日付でグループ化し、日付降順で返す。
 */
export function groupByDateDesc(historyData) {
  const groups = {};
  for (const item of historyData) {
    if (!groups[item.date]) groups[item.date] = [];
    groups[item.date].push(item);
  }
  return Object.entries(groups).sort(([a], [b]) => b.localeCompare(a));
}
