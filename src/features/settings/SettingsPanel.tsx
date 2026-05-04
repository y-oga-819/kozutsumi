"use client";

import { useEffect, useMemo, useState } from "react";

import type { CalendarSubscription } from "@/entities/calendar-subscription/types";

import { useCalendarSubscriptions, type CalendarListItem } from "./useCalendarSubscriptions";

type SettingsPanelProps = {
  open: boolean;
  onClose: () => void;
  /** UserMenu の Google アカウント (= primary external account) の identifier (text)。 */
  primaryExternalAccountId: string | null;
};

/**
 * 設定パネル (Issue #144)。modal 風のオーバーレイ + パネル。
 *
 * - 「カレンダー連携」セクションで Google calendar の subscribe / unsubscribe / auto_promote 切替を行う。
 * - subscription 一覧: 取り込み中の calendar (auto_promote の現在値も表示)。
 * - 候補一覧: Google API で取得した calendar list のうち、未 subscribe のもの。
 *
 * 取り込み中は disabled にして連打を防ぐ。primary calendar (= migration seed の subscription) も
 * 通常の操作対象として扱う (取り込み解除可)。
 */
export function SettingsPanel({ open, onClose, primaryExternalAccountId }: SettingsPanelProps) {
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
      </div>
    </div>
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
