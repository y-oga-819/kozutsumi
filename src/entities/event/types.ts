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
  createdAt: string;
};
