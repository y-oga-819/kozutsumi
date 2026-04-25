import type { HistoryEntry } from "../../entities/task/types";

export const COL = 16;
export const GRAPH_LEFT = 12;

export function laneLeftPx(projectIndex: number): number {
  return GRAPH_LEFT + projectIndex * COL + COL / 2 - 1 + 16;
}

export function nodeCenterPx(projectIndex: number): number {
  return 16 + GRAPH_LEFT + projectIndex * COL + COL / 2;
}

export function lanesWidthPx(projectCount: number): number {
  return GRAPH_LEFT + COL * projectCount + 6;
}

export function groupByDateDesc(historyData: readonly HistoryEntry[]): [string, HistoryEntry[]][] {
  const groups: Record<string, HistoryEntry[]> = {};
  for (const item of historyData) {
    if (!groups[item.date]) groups[item.date] = [];
    groups[item.date].push(item);
  }
  return Object.entries(groups).sort(([a], [b]) => b.localeCompare(a));
}
