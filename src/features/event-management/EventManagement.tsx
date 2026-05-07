"use client";

import { useMemo, useState } from "react";

import type { CalendarSubscription } from "@/entities/calendar-subscription/types";
import { GoogleCalendarBadge } from "@/entities/event/GoogleCalendarBadge";
import { RecurringScopeModal } from "@/entities/event/RecurringScopeModal";
import {
  EVENT_SOURCE,
  type Event,
  type EventVisibilityOverride,
  type EventVisibilityOverrideScope,
} from "@/entities/event/types";
import {
  fmtDuration,
  formatAllDayRange,
  formatClock,
  isAllDayEvent,
  isDeadlineEvent,
  localDateOf,
} from "@/shared/lib/time";

import { computeEventVisibilityState } from "./visibilityState";

type EventManagementProps = {
  events: readonly Event[];
  subscriptions: readonly CalendarSubscription[];
  /**
   * Issue #145 / ADR 0032 Layer 3: 個別 event の予定化 / 解除を切り替える。
   * 'none' へのリセットは含まない (日常 UI では reset 不可、SettingsPanel 専用導線)。
   */
  onSetVisibilityOverride: (id: string, value: EventVisibilityOverride) => Promise<void>;
  /**
   * Issue #229 / ADR 0056: recurring event の系列 override (bulk apply + rule 永続化)。
   * scope='this_and_following' | 'all' のみ受け付ける ('single' は onSetVisibilityOverride を使う)。
   * 未指定なら recurring instance に対しても 3 択 modal を出さず既存の single 操作のみ
   * (テストや特殊呼び出しで省略可)。
   */
  onSetRecurringVisibilityOverride?: (
    id: string,
    value: "shown" | "hidden",
    scope: Exclude<EventVisibilityOverrideScope, "single">,
  ) => Promise<void>;
  /** 詳細パネルを開きたいとき。未指定なら詳細リンクを出さない (テスト用に省略可)。 */
  onOpenEvent?: (id: string) => void;
};

type FilterMode = "all" | "shown" | "hidden" | "overridden";

const FILTER_MODES: { key: FilterMode; label: string; help: string }[] = [
  { key: "all", label: "すべて", help: "取り込み済みのすべての予定" },
  { key: "shown", label: "予定化中", help: "タイムラインに乗っている予定" },
  { key: "hidden", label: "予定化解除中", help: "タイムラインに乗っていない予定" },
  { key: "overridden", label: "個別指定中", help: "default と異なる個別指定をした予定" },
];

/**
 * 取り込んだ events 全件を一覧して、個別に予定化 / 解除できる管理ページ (Issue #145)。
 *
 * 用途:
 * - auto-promote=OFF の calendar に取り込んだ event を後から個別予定化する導線
 *   (#145 完了条件: 「これがないと auto-promote OFF の calendar の使い勝手が破綻する」)
 * - 「予定化中の予定は何か」を一覧で確認する
 * - 過去 event の振り返り override (ADR 0034 L8: 制限なし)
 *
 * default で `start_time` 降順 (= 新しい順) に並べる。日付ごとにグルーピングして表示する。
 */
export function EventManagement({
  events,
  subscriptions,
  onSetVisibilityOverride,
  onSetRecurringVisibilityOverride,
  onOpenEvent,
}: EventManagementProps) {
  const [filter, setFilter] = useState<FilterMode>("all");
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // ADR 0056: recurring instance に対して開かれた scope modal の状態。
  // 操作対象 event id と倒したい方向 (`shown` / `hidden`) を保持。
  const [scopeModal, setScopeModal] = useState<{
    eventId: string;
    targetValue: "shown" | "hidden";
  } | null>(null);

  // 安定した参照のため useMemo (subscriptions が変わったときだけ再計算)。
  const subVisibilities = useMemo(
    () =>
      subscriptions.map((s) => ({
        source: s.source,
        externalCalendarId: s.externalCalendarId,
        autoPromoteToTimeline: s.autoPromoteToTimeline,
      })),
    [subscriptions],
  );

  const subDisplayMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of subscriptions) {
      m.set(`${s.source}::${s.externalCalendarId}`, s.displayName ?? s.externalCalendarId);
    }
    return m;
  }, [subscriptions]);

  const enriched = useMemo(() => {
    return (
      events
        .map((ev) => {
          const state = computeEventVisibilityState(ev, subVisibilities);
          const calendarLabel =
            ev.source === EVENT_SOURCE.MANUAL
              ? "手動追加"
              : (subDisplayMap.get(`${ev.source}::${ev.externalCalendarId}`) ??
                ev.externalCalendarId);
          return { event: ev, state, calendarLabel };
        })
        // start_time 降順 (新しい順)
        .sort((a, b) => (a.event.startTime < b.event.startTime ? 1 : -1))
    );
  }, [events, subVisibilities, subDisplayMap]);

  const filtered = useMemo(() => {
    if (filter === "all") return enriched;
    if (filter === "shown") return enriched.filter((x) => x.state.effectiveShown);
    if (filter === "hidden") return enriched.filter((x) => !x.state.effectiveShown);
    return enriched.filter((x) => x.state.override !== "none");
  }, [enriched, filter]);

  // 日付ごとにグループ化 (ローカル日付)。
  const groups = useMemo(() => {
    const map = new Map<string, typeof filtered>();
    for (const x of filtered) {
      const key = localDateOf(x.event.startTime);
      const existing = map.get(key);
      if (existing) existing.push(x);
      else map.set(key, [x]);
    }
    return [...map.entries()];
  }, [filtered]);

  const handleToggle = async (event: Event, next: EventVisibilityOverride) => {
    // ADR 0056: recurring instance かつ系列操作 callback が渡されているときだけ 3 択 modal を出す。
    // 単発 event (recurringEventId === null) や callback 未指定は従来の single 操作のまま。
    const supportsRecurringScope =
      !!onSetRecurringVisibilityOverride &&
      event.recurringEventId !== null &&
      (next === "shown" || next === "hidden");
    if (supportsRecurringScope) {
      setScopeModal({ eventId: event.id, targetValue: next as "shown" | "hidden" });
      return;
    }
    setPendingId(event.id);
    setError(null);
    try {
      await onSetVisibilityOverride(event.id, next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "予定化の切替に失敗しました");
    } finally {
      setPendingId(null);
    }
  };

  const handleScopeSelect = async (scope: EventVisibilityOverrideScope) => {
    if (!scopeModal) return;
    const { eventId, targetValue } = scopeModal;
    setPendingId(eventId);
    setError(null);
    try {
      if (scope === "single") {
        await onSetVisibilityOverride(eventId, targetValue);
      } else {
        await onSetRecurringVisibilityOverride!(eventId, targetValue, scope);
      }
      setScopeModal(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "予定化の切替に失敗しました");
    } finally {
      setPendingId(null);
    }
  };

  return (
    <div className="px-5 pt-3">
      <header className="mb-3">
        <h1 className="m-0 font-jp text-[14px] font-bold text-fg-emphasized">予定管理</h1>
        <p className="mt-1 text-[11px] leading-relaxed text-fg-muted">
          取り込み済みの予定を一覧します。個別に「予定化」「予定化解除」すると、その判断はカレンダーごとの自動予定化設定より優先されます。
        </p>
      </header>

      <div role="tablist" aria-label="予定の表示フィルタ" className="mb-3 flex gap-1">
        {FILTER_MODES.map((m) => {
          const active = filter === m.key;
          return (
            <button
              key={m.key}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setFilter(m.key)}
              title={m.help}
              className={`rounded-[4px] px-2.5 py-[3px] font-jp text-[11px] ${
                active
                  ? "bg-bg-divider text-fg-emphasized"
                  : "bg-transparent text-fg-weak hover:text-fg-subtle"
              }`}
            >
              {m.label}
            </button>
          );
        })}
      </div>

      {error ? (
        <div
          role="alert"
          className="mb-3 rounded bg-[#ef444420] px-2 py-1.5 text-[11px] text-accent-red"
        >
          {error}
        </div>
      ) : null}

      {filtered.length === 0 ? (
        <p className="py-8 text-center text-[11px] text-fg-muted">
          {filter === "overridden"
            ? "個別指定している予定はまだありません。"
            : "取り込み済みの予定がありません。"}
        </p>
      ) : (
        // 日付グループは <section> で囲む (listitem 役割を持たせない: e2e の getByRole('listitem')
        // が leaf の event row だけを返すようにするため)。leaf 行のみが role=listitem。
        <div className="space-y-4 pb-[80px]">
          {groups.map(([dateKey, items]) => (
            <section key={dateKey} aria-label={dateKey}>
              <div className="mb-1 font-jp text-[10px] uppercase tracking-wider text-fg-faint">
                {dateKey}
              </div>
              <ul role="list" className="m-0 list-none space-y-1.5 p-0">
                {items.map(({ event, state, calendarLabel }) => (
                  <EventRow
                    key={event.id}
                    event={event}
                    effectiveShown={state.effectiveShown}
                    overrideValue={state.override}
                    isOverrideOfDefault={state.isOverrideOfDefault}
                    calendarLabel={calendarLabel}
                    onToggle={(next) => handleToggle(event, next)}
                    onOpenEvent={onOpenEvent}
                    busy={pendingId === event.id}
                  />
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
      {scopeModal ? (
        <RecurringScopeModal
          targetValue={scopeModal.targetValue}
          pending={pendingId === scopeModal.eventId}
          onSelect={handleScopeSelect}
          onClose={() => setScopeModal(null)}
        />
      ) : null}
    </div>
  );
}

type EventRowProps = {
  event: Event;
  effectiveShown: boolean;
  overrideValue: EventVisibilityOverride;
  isOverrideOfDefault: boolean;
  calendarLabel: string;
  onToggle: (value: EventVisibilityOverride) => void;
  onOpenEvent?: (id: string) => void;
  busy: boolean;
};

function EventRow({
  event,
  effectiveShown,
  overrideValue,
  isOverrideOfDefault,
  calendarLabel,
  onToggle,
  onOpenEvent,
  busy,
}: EventRowProps) {
  const overrideActive = overrideValue !== "none";
  const next: EventVisibilityOverride = effectiveShown ? "hidden" : "shown";
  const buttonLabel = effectiveShown ? "予定化解除" : "予定化する";
  // ADR-0050: 終日 / ゼロ長は専用ラベルで描画する。
  const isAllDay = isAllDayEvent(event);
  const isDeadline = !isAllDay && isDeadlineEvent(event);
  const start = formatClock(event.startTime);
  const end = formatClock(event.endTime);
  const minutes = Math.max(
    0,
    Math.round((new Date(event.endTime).getTime() - new Date(event.startTime).getTime()) / 60000),
  );

  return (
    <li className="flex items-start gap-3 rounded-md border border-bg-divider bg-bg-primary px-3 py-2">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          {event.source === EVENT_SOURCE.GOOGLE_CALENDAR ? <GoogleCalendarBadge size="sm" /> : null}
          <span
            className={`rounded-[3px] border px-1 py-[1px] font-jp text-[9px] ${
              effectiveShown
                ? "border-accent-blue/40 text-accent-blue"
                : "border-bg-divider text-fg-weak"
            }`}
          >
            {effectiveShown ? "予定化中" : "予定化解除中"}
          </span>
          {overrideActive ? (
            <span
              className={`rounded-[3px] border px-1 py-[1px] font-jp text-[9px] ${
                isOverrideOfDefault
                  ? "border-accent-amber/50 text-accent-amber"
                  : "border-bg-divider text-fg-weak"
              }`}
              title={
                isOverrideOfDefault
                  ? "カレンダーの自動予定化設定と異なる個別指定をしています"
                  : "個別指定していますが、カレンダー側の自動予定化設定と同じ方向です"
              }
            >
              個別指定中
            </span>
          ) : null}
          <span className="truncate text-[10px] text-fg-faint">{calendarLabel}</span>
        </div>
        {onOpenEvent ? (
          <button
            type="button"
            onClick={() => onOpenEvent(event.id)}
            className="mt-1 block w-full truncate text-left font-jp text-[12px] font-medium text-fg-emphasized hover:underline"
            title={event.title}
          >
            {event.title}
          </button>
        ) : (
          <div
            className="mt-1 truncate font-jp text-[12px] font-medium text-fg-emphasized"
            title={event.title}
          >
            {event.title}
          </div>
        )}
        <div className="mt-0.5 text-[10px] tabular-nums text-fg-weak">
          {isAllDay ? (
            <>
              <span
                aria-label="終日"
                className="mr-1.5 rounded-[3px] border border-bg-divider px-1 py-px font-jp text-[9px] text-fg-subtle"
              >
                終日
              </span>
              {formatAllDayRange(event)}
            </>
          ) : isDeadline ? (
            <span aria-label={`${start} 締切`}>⏰ {start}</span>
          ) : (
            <>
              {start}–{end} ({fmtDuration(minutes)})
            </>
          )}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        {overrideActive ? (
          <button
            type="button"
            onClick={() => onToggle("none")}
            disabled={busy}
            className="rounded-[4px] border border-bg-divider bg-transparent px-2.5 py-[3px] font-jp text-[10px] text-fg-weak disabled:opacity-60"
            title="個別指定を解除して、カレンダーの自動予定化設定に従う動作に戻す"
          >
            リセット
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => onToggle(next)}
          disabled={busy}
          className="rounded-[4px] border border-bg-divider bg-transparent px-2.5 py-[3px] font-jp text-[10px] text-fg-subtle disabled:opacity-60"
        >
          {buttonLabel}
        </button>
      </div>
    </li>
  );
}
