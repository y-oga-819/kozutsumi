import type { ProjectKey } from "../project/types";

export type TaskStatus = "idle" | "active" | "paused" | "done";

export type TaskSize = "S" | "M" | "L";

export type Task = {
  id: string;
  project: ProjectKey;
  title: string;
  size: TaskSize;
  done: boolean;
  dependsOn: string | null;
  body: string;
};

export type HistoryEntry = {
  id: string;
  project: ProjectKey;
  title: string;
  date: string;
  done: true;
};
