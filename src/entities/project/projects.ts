import type { ProjectKey, ProjectMap } from "./types";

export const PROJECTS: ProjectMap = {
  career: { name: "転職活動", color: "#E85D04" },
  loadtest: { name: "負荷試験", color: "#0096C7" },
  slo: { name: "SLO推進", color: "#2D9F45" },
  tasuki: { name: "Tasuki", color: "#9B5DE5" },
};

export const projectOrder: readonly ProjectKey[] = [
  "career",
  "loadtest",
  "slo",
  "tasuki",
];
