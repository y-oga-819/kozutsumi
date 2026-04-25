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

/**
 * Google Calendar から取り込む 1 イベント分の入力。
 * `project_id` は kozutsumi 側で設定する拡張 (ADR 0010) なので、upsert payload には含めず既存値を保持する。
 */
export type UpsertGoogleCalendarEventInput = {
  externalId: string;
  title: string;
  startTime: string;
  endTime: string;
  meetUrl: string | null;
  hasAttachments: boolean;
  description: string;
};

export interface EventGateway {
  list(): Promise<Event[]>;
  create(input: CreateEventInput): Promise<Event>;
  update(id: string, patch: UpdateEventInput): Promise<Event>;
  delete(id: string): Promise<void>;
  deleteAllForCurrentUser(): Promise<void>;
  /**
   * `(source='google_calendar', external_id)` 単位で upsert。既存行の `project_id` は保持する。
   * @returns upsert された行数
   */
  upsertFromGoogleCalendar(inputs: UpsertGoogleCalendarEventInput[]): Promise<number>;
  /**
   * Google 側で `status='cancelled'` になったイベントをローカルから削除する。
   * @returns 削除された行数
   */
  deleteByGoogleExternalIds(externalIds: string[]): Promise<number>;
}
