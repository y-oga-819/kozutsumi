import type { Event, EventVisibilityOverride } from "./types";

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
 * `externalCalendarId` (ADR 0033 / 0049) は subscription を介して呼び出し元が決める。primary calendar は
 * Google API resolve した実 id (= email)。リテラル `'primary'` は使わない。
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
  /**
   * 削除前の events 行を triple ベースで取得する (ADR 0034 L5/L9 / ADR 0035 §2 ii: snapshot 必須)。
   * `event_deleted_by_source` / `calendar_unsubscribed` / `task_event_dependency_lost` の
   * action_log payload を組み立てるために、削除直前の title / start / end / visibility_override と
   * events.id を読み取る。
   */
  findGoogleEventSnapshots(
    externalCalendarId: string,
    externalIds: string[],
  ): Promise<DeletedEventSnapshot[]>;
  /**
   * 指定 calendar に紐づく google_calendar source の全 events を取得する
   * (ADR 0034 L9 unsubscribe フロー用)。`external_id` は NOT NULL 前提 (sync 経路で必ず埋める)。
   */
  findAllGoogleEventsByCalendar(externalCalendarId: string): Promise<DeletedEventSnapshot[]>;
  /** 指定 calendar に紐づく google_calendar source の events を一括削除する。 */
  deleteAllGoogleEventsByCalendar(externalCalendarId: string): Promise<number>;
  /**
   * Issue #145 / ADR 0032: event 単位の `visibility_override` を更新する。
   * 戻り値は更新後の Event。Layer 3 操作 UI (EventDetailPanel / 予定管理ページ /
   * SettingsPanel の override 一覧) から呼ばれる。
   */
  setVisibilityOverride(id: string, value: EventVisibilityOverride): Promise<Event>;
}

/**
 * 削除直前の events 行を action_log snapshot 用に表現したもの。
 * `id` (kozutsumi 内 uuid) は depends_on_event_id 解析のために残す。
 */
export type DeletedEventSnapshot = {
  id: string;
  externalId: string;
  title: string;
  startTime: string;
  endTime: string;
  visibilityOverride: "none" | "shown" | "hidden";
};
