import type { Event } from "./types";

export type CreateEventInput = {
  title: string;
  startTime: string;
  endTime: string;
  projectId?: string | null;
  meetUrl?: string | null;
  hasAttachments?: boolean;
  description?: string;
  source?: Event["source"];
  externalId?: string | null;
};

export type UpdateEventInput = {
  title?: string;
  startTime?: string;
  endTime?: string;
  projectId?: string | null;
  meetUrl?: string | null;
  hasAttachments?: boolean;
  description?: string;
};

export interface EventGateway {
  list(): Promise<Event[]>;
  create(input: CreateEventInput): Promise<Event>;
  update(id: string, patch: UpdateEventInput): Promise<Event>;
  delete(id: string): Promise<void>;
  deleteAllForCurrentUser(): Promise<void>;
}
