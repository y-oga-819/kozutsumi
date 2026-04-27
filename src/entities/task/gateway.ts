import type { DecomposeStatus, Task } from "./types";

export type CreateTaskInput = {
  projectId: string;
  title: string;
  body?: string;
  estimatedMinutes?: number | null;
  stackOrder?: number | null;
  dependsOnEventId?: string | null;
  isInterruption?: boolean;
  parentTaskId?: string | null;
  decomposeStatus?: DecomposeStatus;
};

export type UpdateTaskInput = {
  projectId?: string;
  title?: string;
  body?: string;
  estimatedMinutes?: number | null;
  status?: Task["status"];
  stackOrder?: number | null;
  dependsOnEventId?: string | null;
  isInterruption?: boolean;
  decomposeStatus?: DecomposeStatus;
  completedAt?: string | null;
};

/**
 * 判断 5 (auth 隠蔽): `user_id` は interface に現れず、具象実装内で
 * `auth.getUser()` 相当を解決する。
 */
export interface TaskGateway {
  list(): Promise<Task[]>;
  create(input: CreateTaskInput): Promise<Task>;
  update(id: string, patch: UpdateTaskInput): Promise<Task>;
  reorder(entries: readonly { id: string; stackOrder: number | null }[]): Promise<void>;
  delete(id: string): Promise<void>;
  deleteAllForCurrentUser(): Promise<void>;
}
