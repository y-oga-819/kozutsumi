"use client";

import { useEffect, useMemo, useState } from "react";

import type { CalendarSubscription } from "@/entities/calendar-subscription/types";
import { EVENT_SOURCE, type Event, type EventVisibilityOverride } from "@/entities/event/types";
import {
  formatAllDayRange,
  formatClock,
  isAllDayEvent,
  isDeadlineEvent,
  localDateOf,
} from "@/shared/lib/time";

import { useCalendarSubscriptions, type CalendarListItem } from "./useCalendarSubscriptions";

type SettingsPanelProps = {
  open: boolean;
  onClose: () => void;
  /** UserMenu の Google アカウント (= primary external account) の identifier (text)。 */
  primaryExternalAccountId: string | null;
  /** Issue #145: override 一覧の元データ。 */
  events: readonly Event[];
  /**
   * Issue #145 / ADR 0032: override 一覧から個別 reset (`'none'`) する唯一の導線。
   * 日常 UI からの reset は禁止 (ADR 0032)、本 panel 専用。
   */
  onSetVisibilityOverride: (id: string, value: EventVisibilityOverride) => Promise<void>;
};

/**
 * 設定パネル (Issue #144)。modal 風のオーバーレイ + パネル。
 *
 * - 「カレンダー連携」セクションで Google calendar の subscribe / unsubscribe / auto_promote 切替を行う。
 * - subscription 一覧: 取り込み中の calendar (auto_promote の現在値も表示)。
 * - 候補一覧: Google API で取得した calendar list のうち、未 subscribe のもの。
 *
 * 取り込み中は disabled にして連打を防ぐ。primary calendar (= 初回 sync 時に lazy seed される
 * subscription、ADR 0052) も通常の操作対象として扱う (取り込み解除可)。
 * 候補との dedup は `external_calendar_id` の文字列比較。primary は Google API resolve した実 id
 * (= email) で保存しているため、Google calendarList の `id` とそのまま一致する (ADR 0052)。
 */
export function SettingsPanel({
  open,
  onClose,
  primaryExternalAccountId,
  events,
  onSetVisibilityOverride,
}: SettingsPanelProps) {
  const { subscriptionsQuery, calendarListQuery, subscribe, unsubscribe, toggleAutoPromote } =
    useCalendarSubscriptions();

  // open 切替時に candidates を再取得 (panel を一度閉じて開き直したら最新化される)。
  // useQuery の staleTime 30s で過剰な fetch は抑止。
  const subscriptions = useMemo(() => subscriptionsQuery.data ?? [], [subscriptionsQuery.data]);
  const subscribedCalendarIds = useMemo(
    () => new Set(subscriptions.map((s) => s.externalCalendarId)),
    [subscriptions],
  );
  const candidates = useMemo(
    () =>
      (calendarListQuery.data?.items ?? []).filter(
        (c) => !subscribedCalendarIds.has(c.id) && c.accessRole !== "freeBusyReader",
      ),
    [calendarListQuery.data, subscribedCalendarIds],
  );

  // ESC で閉じる
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const needsReauth = calendarListQuery.data?.needsReauth === true;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="設定"
      className="fixed inset-0 z-[60] flex items-start justify-center bg-black/40 p-4 pt-[6vh]"
      onClick={onClose}
    >
      <div
        className="relative max-h-[80vh] w-full max-w-[560px] overflow-y-auto rounded-lg border border-bg-divider bg-bg-elevated p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-baseline justify-between gap-2">
          <h2 className="font-jp text-[14px] font-semibold text-fg-emphasized">設定</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="閉じる"
            className="text-[12px] text-fg-muted hover:text-fg-emphasized"
          >
            閉じる
          </button>
        </div>

        <section aria-label="カレンダー連携" className="mt-2">
          <h3 className="mb-2 text-[12px] font-semibold text-fg-emphasized">カレンダー連携</h3>
          <p className="mb-3 text-[11px] leading-relaxed text-fg-muted">
            取り込み対象のカレンダーと、自動でタイムラインに表示するかを設定します。
          </p>

          {needsReauth ? (
            <div className="mb-3 rounded-md border border-accent-amber/40 bg-accent-amber/10 px-3 py-2 text-[11px] text-fg-emphasized">
              Google と連携し直してから一覧を取得してください。
            </div>
          ) : null}

          <div className="space-y-2">
            <div className="text-[11px] font-medium text-fg-muted">取り込み中</div>
            {subscriptionsQuery.isLoading ? (
              <p className="text-[11px] text-fg-muted">読み込み中…</p>
            ) : subscriptions.length === 0 ? (
              <p className="text-[11px] text-fg-muted">まだ何も取り込んでいません。</p>
            ) : (
              <ul role="list" className="m-0 list-none space-y-1.5 p-0">
                {subscriptions.map((s) => (
                  <SubscriptionRow
                    key={s.id}
                    subscription={s}
                    onToggleAutoPromote={(value) =>
                      toggleAutoPromote.mutate({
                        subscriptionId: s.id,
                        autoPromoteToTimeline: value,
                      })
                    }
                    onUnsubscribe={() => unsubscribe.mutate(s.id)}
                    busy={
                      toggleAutoPromote.isPending || unsubscribe.isPending || subscribe.isPending
                    }
                  />
                ))}
              </ul>
            )}
          </div>

          <div className="mt-4 space-y-2">
            <div className="text-[11px] font-medium text-fg-muted">追加できるカレンダー</div>
            {calendarListQuery.isLoading ? (
              <p className="text-[11px] text-fg-muted">Google から取得中…</p>
            ) : candidates.length === 0 ? (
              <p className="text-[11px] text-fg-muted">追加できる候補はありません。</p>
            ) : (
              <ul role="list" className="m-0 list-none space-y-1.5 p-0">
                {candidates.map((c) => (
                  <CandidateRow
                    key={c.id}
                    item={c}
                    disabled={subscribe.isPending || !primaryExternalAccountId}
                    onSubscribe={(autoPromote) => {
                      if (!primaryExternalAccountId) return;
                      subscribe.mutate({
                        externalAccountId: primaryExternalAccountId,
                        externalCalendarId: c.id,
                        autoPromoteToTimeline: autoPromote,
                        displayName: c.summary ?? null,
                        color: c.backgroundColor ?? null,
                      });
                    }}
                  />
                ))}
              </ul>
            )}
          </div>
        </section>

        <OverridesSection
          events={events}
          subscriptions={subscriptions}
          onSetVisibilityOverride={onSetVisibilityOverride}
        />
      </div>
    </div>
  );
}

function OverridesSection({
  events,
  subscriptions,
  onSetVisibilityOverride,
}: {
  events: readonly Event[];
  subscriptions: CalendarSubscription[];
  onSetVisibilityOverride: (id: string, value: EventVisibilityOverride) => Promise<void>;
}) {
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const subDisplayMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of subscriptions) {
      m.set(`${s.source}::${s.externalCalendarId}`, s.displayName ?? s.externalCalendarId);
    }
    return m;
  }, [subscriptions]);

  // ADR 0032: 設定画面の override 一覧 = `visibility_override !== 'none'` を一覧、reset 専用導線。
  // start_time 降順 (新しい順) で並べる。
  const overridden = useMemo(
    () =>
      events
        .filter((e) => e.visibilityOverride !== "none")
        .map((e) => ({
          event: e,
          calendarLabel:
            e.source === EVENT_SOURCE.MANUAL
              ? "手動追加"
              : (subDisplayMap.get(`${e.source}::${e.externalCalendarId}`) ?? e.externalCalendarId),
        }))
        .sort((a, b) => (a.event.startTime < b.event.startTime ? 1 : -1)),
    [events, subDisplayMap],
  );

  const handleReset = async (id: string) => {
    setPendingId(id);
    setError(null);
    try {
      await onSetVisibilityOverride(id, "none");
    } catch (err) {
      setError(err instanceof Error ? err.message : "リセットに失敗しました");
    } finally {
      setPendingId(null);
    }
  };

  return (
    <section aria-label="個別予定化の設定" className="mt-6 border-t border-bg-divider pt-4">
      <h3 className="mb-2 text-[12px] font-semibold text-fg-emphasized">個別予定化の設定</h3>
      <p className="mb-3 text-[11px] leading-relaxed text-fg-muted">
        「予定化」「予定化解除」を個別に指定した予定の一覧です。リセットすると、そのカレンダーの自動予定化設定に従う動作に戻ります。
      </p>

      {error ? (
        <div
          role="alert"
          className="mb-2 rounded bg-[#ef444420] px-2 py-1.5 text-[11px] text-accent-red"
        >
          {error}
        </div>
      ) : null}

      {overridden.length === 0 ? (
        <p className="text-[11px] text-fg-muted">個別指定している予定はまだありません。</p>
      ) : (
        <ul role="list" className="m-0 list-none space-y-1.5 p-0">
          {overridden.map(({ event, calendarLabel }) => (
            <li
              key={event.id}
              className="flex items-start gap-3 rounded-md border border-bg-divider bg-bg-primary px-3 py-2"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span
                    className={`rounded-[3px] border px-1 py-[1px] font-jp text-[9px] ${
                      event.visibilityOverride === "shown"
                        ? "border-accent-blue/40 text-accent-blue"
                        : "border-bg-divider text-fg-weak"
                    }`}
                  >
                    {event.visibilityOverride === "shown" ? "予定化中" : "予定化解除中"}
                  </span>
                  <span className="truncate text-[10px] text-fg-faint">{calendarLabel}</span>
                </div>
                <div
                  className="mt-1 truncate font-jp text-[12px] font-medium text-fg-emphasized"
                  title={event.title}
                >
                  {event.title}
                </div>
                <div className="mt-0.5 text-[10px] tabular-nums text-fg-weak">
                  {isAllDayEvent(event) ? (
                    <>
                      <span
                        aria-label="終日"
                        className="mr-1.5 rounded-[3px] border border-bg-divider px-1 py-px font-jp text-[9px] text-fg-subtle"
                      >
                        終日
                      </span>
                      {formatAllDayRange(event)}
                    </>
                  ) : isDeadlineEvent(event) ? (
                    <>
                      {localDateOf(event.startTime)}{" "}
                      <span aria-label={`${formatClock(event.startTime)} 締切`}>
                        ⏰ {formatClock(event.startTime)}
                      </span>
                    </>
                  ) : (
                    <>
                      {localDateOf(event.startTime)} {formatClock(event.startTime)}–
                      {formatClock(event.endTime)}
                    </>
                  )}
                </div>
              </div>
              <div className="flex shrink-0 items-center">
                <button
                  type="button"
                  onClick={() => handleReset(event.id)}
                  disabled={pendingId === event.id}
                  className="rounded-[4px] border border-bg-divider bg-transparent px-2.5 py-[3px] font-jp text-[10px] text-fg-subtle disabled:opacity-60"
                >
                  リセット
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function SubscriptionRow({
  subscription,
  onToggleAutoPromote,
  onUnsubscribe,
  busy,
}: {
  subscription: CalendarSubscription;
  onToggleAutoPromote: (value: boolean) => void;
  onUnsubscribe: () => void;
  busy: boolean;
}) {
  const [confirmingUnsubscribe, setConfirmingUnsubscribe] = useState(false);
  const label = subscription.displayName ?? subscription.externalCalendarId;
  return (
    <li className="rounded-md border border-bg-divider bg-bg-primary px-3 py-2">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div
            className="truncate font-jp text-[12px] font-medium text-fg-emphasized"
            title={label}
          >
            {label}
          </div>
          <div
            className="mt-0.5 truncate text-[10px] text-fg-muted"
            title={subscription.externalAccountIdentifier}
          >
            {subscription.externalAccountIdentifier}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <label className="flex items-center gap-1.5 text-[11px] text-fg-muted">
            <input
              type="checkbox"
              checked={subscription.autoPromoteToTimeline}
              onChange={(e) => onToggleAutoPromote(e.target.checked)}
              disabled={busy}
              aria-label={`${label} を自動で予定化`}
            />
            <span>自動予定化</span>
          </label>
        </div>
      </div>
      <div className="mt-2 flex justify-end">
        {confirmingUnsubscribe ? (
          <div className="flex items-center gap-2 text-[11px]">
            <span className="text-fg-muted">取り込み解除する?</span>
            <button
              type="button"
              onClick={() => {
                setConfirmingUnsubscribe(false);
                onUnsubscribe();
              }}
              disabled={busy}
              className="rounded bg-accent-amber/80 px-2 py-0.5 text-[10px] font-medium text-bg-primary hover:bg-accent-amber disabled:opacity-60"
            >
              解除
            </button>
            <button
              type="button"
              onClick={() => setConfirmingUnsubscribe(false)}
              disabled={busy}
              className="rounded border border-bg-divider px-2 py-0.5 text-[10px] text-fg-muted hover:text-fg-emphasized"
            >
              キャンセル
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmingUnsubscribe(true)}
            disabled={busy}
            className="text-[10px] text-fg-muted hover:text-accent-amber disabled:opacity-60"
          >
            取り込み解除
          </button>
        )}
      </div>
    </li>
  );
}

function CandidateRow({
  item,
  disabled,
  onSubscribe,
}: {
  item: CalendarListItem;
  disabled: boolean;
  onSubscribe: (autoPromote: boolean) => void;
}) {
  const [autoPromote, setAutoPromote] = useState(true);
  const label = item.summary ?? item.id;
  return (
    <li className="rounded-md border border-bg-divider bg-bg-primary px-3 py-2">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div
            className="flex items-center gap-2 truncate font-jp text-[12px] font-medium text-fg-emphasized"
            title={label}
          >
            {item.backgroundColor ? (
              <span
                aria-hidden
                className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: item.backgroundColor }}
              />
            ) : null}
            <span className="truncate">{label}</span>
            {item.primary ? (
              <span className="shrink-0 rounded border border-bg-divider px-1 text-[9px] text-fg-muted">
                primary
              </span>
            ) : null}
          </div>
          {item.description ? (
            <div className="mt-0.5 truncate text-[10px] text-fg-muted" title={item.description}>
              {item.description}
            </div>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <label className="flex items-center gap-1.5 text-[10px] text-fg-muted">
            <input
              type="checkbox"
              checked={autoPromote}
              onChange={(e) => setAutoPromote(e.target.checked)}
              disabled={disabled}
              aria-label={`${label} を自動で予定化`}
            />
            <span>自動予定化</span>
          </label>
          <button
            type="button"
            onClick={() => onSubscribe(autoPromote)}
            disabled={disabled}
            className="rounded bg-accent-blue/90 px-2 py-0.5 text-[10px] font-medium text-bg-primary hover:bg-accent-blue disabled:opacity-60"
          >
            取り込む
          </button>
        </div>
      </div>
    </li>
  );
}
