import type { Project } from "./types";

export type CreateProjectInput = {
  name: string;
  color: string;
  isPrimary?: boolean;
};

export type UpdateProjectInput = {
  name?: string;
  color?: string;
  isPrimary?: boolean;
};

export interface ProjectGateway {
  list(): Promise<Project[]>;
  create(input: CreateProjectInput): Promise<Project>;
  update(id: string, patch: UpdateProjectInput): Promise<Project>;
  delete(id: string): Promise<void>;
  deleteAllForCurrentUser(): Promise<void>;
}
