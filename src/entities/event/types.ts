export type EventSource = "manual" | "google_calendar";

export const EVENT_SOURCE = {
  MANUAL: "manual",
  GOOGLE_CALENDAR: "google_calendar",
} as const satisfies Record<string, EventSource>;

/**
 * Event の表示 / 取り込み制御 (ADR 0032)。
 * - none: subscription default (auto_promote_to_timeline) に従う
 * - shown: ユーザーが明示的に「予定化」した個別 override
 * - hidden: ユーザーが明示的に「予定化解除」した個別 override
 * 三値モデル (`info_only` 等) は ADR 0032 で将来拡張余地のみ確保。
 */
export type EventVisibilityOverride = "none" | "shown" | "hidden";

/**
 * DB スキーマ (supabase/migrations/..._initial_schema.sql の events) と 1:1 対応。
 * 時刻は ISO 8601 文字列 (timestamptz) として扱う。
 *
 * `externalCalendarId` は ADR 0033 の triple `(source, externalCalendarId, externalId)`
 * の中間軸。manual は 'manual'、google_calendar 由来は subscription の calendar id。
 *
 * `recurringEventId` は ADR 0056 の recurring グループ識別子 (Google Calendar の master
 * event id)。NULL = 単発 event。`source` + `externalCalendarId` + `recurringEventId` で
 * recurring グループを一意に識別する。
 */
export type Event = {
  id: string;
  title: string;
  startTime: string;
  endTime: string;
  projectId: string | null;
  meetUrl: string | null;
  hasAttachments: boolean;
  description: string;
  source: EventSource;
  externalId: string | null;
  externalCalendarId: string;
  visibilityOverride: EventVisibilityOverride;
  /** ADR 0056: recurring の master id。NULL = 単発 event。 */
  recurringEventId: string | null;
  createdAt: string;
};

/**
 * ADR 0056: recurring 系列 override の適用範囲。
 * - `single`: 操作対象の 1 instance のみ (default、既存 #145 と同じ semantics)
 * - `this_and_following`: 操作対象 instance の `start_time` 以降の全 instance + 新規取り込み
 * - `all`: 全 instance + 新規取り込み (過去含む)
 */
export type EventVisibilityOverrideScope = "single" | "this_and_following" | "all";

/**
 * ADR 0056: 系列 override の方針 (rule) を表現する。新規 instance 取り込み時の default を
 * 上書きするための「方針レイヤ」。1 recurring グループ (source + externalCalendarId +
 * recurringEventId) につき rule は 1 件まで。
 */
export type EventVisibilityOverrideRule = {
  id: string;
  source: EventSource;
  externalCalendarId: string;
  recurringEventId: string;
  scope: "this_and_following" | "all";
  overrideValue: "shown" | "hidden";
  /** scope='this_and_following' のとき必須、'all' のとき null。 */
  fromStartTime: string | null;
  createdAt: string;
};
