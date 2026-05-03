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
 * `externalCalendarId` (ADR 0033) は subscription を介して呼び出し元が決める (現状は 'primary' 固定)。
 * `visibility_override` も同期で再 upsert されても触らない (ADR 0034 L4)。
 */
export type UpsertGoogleCalendarEventInput = {
  externalCalendarId: string;
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
   * `(source='google_calendar', external_calendar_id, external_id)` 単位で upsert (ADR 0033)。
   * 既存行の `project_id` / `visibility_override` は保持する (ADR 0010 / 0034 L4)。
   * @returns upsert された行数
   */
  upsertFromGoogleCalendar(inputs: UpsertGoogleCalendarEventInput[]): Promise<number>;
  /**
   * Google 側で `status='cancelled'` になったイベントをローカルから削除する。
   * 同じ external_id が他 calendar にも存在しうる (ADR 0033) ので、calendar 単位で絞る。
   * @returns 削除された行数
   */
  deleteByGoogleExternalIds(externalCalendarId: string, externalIds: string[]): Promise<number>;
}
