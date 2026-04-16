import type { ProjectKey } from "../project/types";

export type EventSource = "manual" | "google_calendar";

export type Event = {
  id: string;
  title: string;
  time: string;
  endTime: string;
  date: string;
  project?: ProjectKey;
  meetUrl?: string;
  attachments?: string[];
  description: string;
  source?: EventSource;
};
