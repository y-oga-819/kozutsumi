import type { Task } from "@/entities/task/types";

export function isDone(task: Task): boolean {
  return task.status === "done";
}
