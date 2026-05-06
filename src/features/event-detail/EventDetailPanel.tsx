import { useEffect, useState } from "react";

import type { UpdateEventInput } from "../../entities/event/gateway";
import {
  EVENT_SOURCE,
  type Event,
  type EventVisibilityOverride,
  type EventVisibilityOverrideScope,
} from "../../entities/event/types";
import { GoogleCalendarBadge } from "../../entities/event/GoogleCalendarBadge";
import { getProject } from "../../entities/project/projects";
import { useProjects } from "../../entities/project/ProjectsContext";
import {
  fmtDuration,
  formatAllDayRange,
  formatClock,
  isAllDayEvent,
  isDeadlineEvent,
  minutesOfDay,
  toDateTimeLocalInput,
} from "../../shared/lib/time";
import { renderMarkdown } from "../../shared/lib/markdown";

type EventDetailPanelProps = {
  event: Event;
  onClose: () => void;
  /**
   * `source === 'google_calendar'` のイベントで `project_id` を変更したい時に呼ぶ。
   * 未指定なら project_id 編集 UI も表示しない (省略可で既存呼び出しを壊さない)。
   */
  onChangeProject?: (id: string, projectId: string | null) => void;
  /**
   * `source === 'manual'` のイベントを編集する時に呼ぶ。`UpdateEventInput` 全体を渡す。
   * 未指定なら manual イベントの編集 UI も表示しない (テストや特殊呼び出しで省略可)。
   * ADR 0010 により google_calendar イベントは Google 側属性 read-only なので、
   * 本コールバックは manual のみで使用する。
   */
  onUpdate?: (id: string, patch: UpdateEventInput) => Promise<void> | void;
  /**
   * `source === 'manual'` のイベントを削除する時に呼ぶ。
   * 未指定なら削除ボタンを表示しない。
   * ADR 0010 により google_calendar イベントは UI から削除不可なので、本コール
   * バックを渡しても source='google_calendar' では削除ボタンを表示しない。
   */
  onDelete?: (id: string) => Promise<void> | void;
  /**
   * Issue #145 / ADR 0032 Layer 3: event 単位の予定化 override を切り替える。
   * 'shown' / 'hidden' 双方向の toggle のみ受け付ける (日常 UI で 'none' へは戻せない)。
   * 未指定なら toggle UI も表示しない (テストや特殊呼び出しで省略可)。
   */
  onSetVisibilityOverride?: (id: string, value: EventVisibilityOverride) => Promise<void> | void;
  /**
   * Issue #229 / ADR 0056: recurring event の系列 override (bulk apply + rule 永続化)。
   * scope='this_and_following' | 'all' のみ受け付ける ('single' は onSetVisibilityOverride を使う)。
   * 未指定なら recurring event でも 3 択 modal を出さず、既存挙動 (single 操作のみ) のままにする。
   */
  onSetRecurringVisibilityOverride?: (
    id: string,
    value: "shown" | "hidden",
    scope: Exclude<EventVisibilityOverrideScope, "single">,
  ) => Promise<void> | void;
  /**
   * 当該 event の calendar subscription の `auto_promote_to_timeline` 値。
   * `visibility_override='none'` のとき、effective visibility 計算に使う。
   * 不明 (subscription なし / manual) のときは true (= 既定で表示) として扱う。
   */
  subscriptionAutoPromote?: boolean;
};

export function EventDetailPanel({
  event,
  onClose,
  onChangeProject,
  onUpdate,
  onDelete,
  onSetVisibilityOverride,
  onSetRecurringVisibilityOverride,
  subscriptionAutoPromote = true,
}: EventDetailPanelProps) {
  const { projects, projectsById } = useProjects();
  const proj = event.projectId ? getProject(projectsById, event.projectId) : null;
  const evColor = proj ? proj.color : "#52525b";
  const evStart = minutesOfDay(event.startTime);
  const evEnd = minutesOfDay(event.endTime);
  const duration = evEnd - evStart;
  // ADR-0050: 終日 / ゼロ長 (締切系) は時刻 + duration の代わりに専用ラベルを出す。
  const isAllDay = isAllDayEvent(event);
  const isDeadline = !isAllDay && isDeadlineEvent(event);
  const isZoom = !!event.meetUrl?.includes("zoom");
  const meetLabel = event.meetUrl?.includes("zoom")
    ? "Zoom"
    : event.meetUrl?.includes("meet.google")
      ? "Google Meet"
      : "会議リンク";
  const isGoogleCalendar = event.source === EVENT_SOURCE.GOOGLE_CALENDAR;
  const isManual = event.source === EVENT_SOURCE.MANUAL;
  // ADR 0010: google_calendar イベントは project_id だけ kozutsumi 側で編集可。
  // onChangeProject が渡されている時のみ編集 UI を出す (テストや特殊呼び出しで省略可)。
  const canEditProject = isGoogleCalendar && !!onChangeProject;
  // ADR 0010: manual イベントだけが全フィールド編集 / 削除可。
  const canEdit = isManual && !!onUpdate;
  const canDelete = isManual && !!onDelete;
  const [editingProject, setEditingProject] = useState(false);
  const [editing, setEditing] = useState(false);
  const [pending, setPending] = useState(false);
  const [visibilityPending, setVisibilityPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Issue #145 / ADR 0031 Layer 3: 現状の effective visibility を計算し、ボタン文言を決める。
  // - override='shown' → effective shown (default 逸脱 or default 一致は問わず表示中)
  // - override='hidden' → effective hidden
  // - override='none' → subscription.auto_promote に従う (manual / 未知 subscription は true 扱い)
  const canToggleVisibility = !!onSetVisibilityOverride && !editing;
  const effectiveShown =
    event.visibilityOverride === "shown"
      ? true
      : event.visibilityOverride === "hidden"
        ? false
        : subscriptionAutoPromote;
  const overrideActive = event.visibilityOverride !== "none";
  // ADR 0056: recurring instance かつ系列操作 callback が渡されているときだけ 3 択 modal を出す。
  // 単発 event (recurringEventId === null) や、callback 未指定 (テスト等) は従来の single 操作のみ。
  const supportsRecurringScope =
    !!onSetRecurringVisibilityOverride && event.recurringEventId !== null;
  const [scopeModalOpen, setScopeModalOpen] = useState(false);
  // modal 開閉中は target を保持 ('shown' / 'hidden' のどちらに倒す操作だったか)。
  const [pendingTargetValue, setPendingTargetValue] = useState<"shown" | "hidden">("shown");

  const handleToggleVisibility = async () => {
    if (visibilityPending || !onSetVisibilityOverride) return;
    const next: EventVisibilityOverride = effectiveShown ? "hidden" : "shown";
    if (supportsRecurringScope && (next === "shown" || next === "hidden")) {
      // ADR 0056 §6: default scope='single' を modal で明示選択させる。modal を開くだけで
      // この時点では DB を触らない。
      setPendingTargetValue(next);
      setScopeModalOpen(true);
      return;
    }
    setVisibilityPending(true);
    setError(null);
    try {
      await onSetVisibilityOverride(event.id, next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "予定化の切替に失敗しました");
    } finally {
      setVisibilityPending(false);
    }
  };

  const handleScopeSelect = async (scope: EventVisibilityOverrideScope) => {
    if (visibilityPending) return;
    setVisibilityPending(true);
    setError(null);
    try {
      if (scope === "single") {
        await onSetVisibilityOverride!(event.id, pendingTargetValue);
      } else {
        await onSetRecurringVisibilityOverride!(event.id, pendingTargetValue, scope);
      }
      setScopeModalOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "予定化の切替に失敗しました");
    } finally {
      setVisibilityPending(false);
    }
  };

  // 編集フォームの draft 値。編集モードに入る時に event 値で初期化する。
  const [draftTitle, setDraftTitle] = useState(event.title);
  const [draftStart, setDraftStart] = useState(toDateTimeLocalInput(event.startTime));
  const [draftEnd, setDraftEnd] = useState(toDateTimeLocalInput(event.endTime));
  const [draftProjectId, setDraftProjectId] = useState(event.projectId ?? "");
  const [draftMeetUrl, setDraftMeetUrl] = useState(event.meetUrl ?? "");
  const [draftBody, setDraftBody] = useState(event.description ?? "");

  const startEdit = () => {
    setDraftTitle(event.title);
    setDraftStart(toDateTimeLocalInput(event.startTime));
    setDraftEnd(toDateTimeLocalInput(event.endTime));
    setDraftProjectId(event.projectId ?? "");
    setDraftMeetUrl(event.meetUrl ?? "");
    setDraftBody(event.description ?? "");
    setError(null);
    setEditing(true);
  };

  const cancelEdit = () => {
    setEditing(false);
    setError(null);
  };

  const submitEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pending || !onUpdate) return;
    if (!draftTitle.trim()) {
      setError("タイトルは必須です");
      return;
    }
    if (!draftStart || !draftEnd) {
      setError("開始/終了時刻は必須です");
      return;
    }
    if (new Date(draftEnd).getTime() <= new Date(draftStart).getTime()) {
      setError("終了時刻は開始時刻より後にしてください");
      return;
    }
    setPending(true);
    setError(null);
    try {
      await onUpdate(event.id, {
        title: draftTitle.trim(),
        // datetime-local はローカル tz-naive 値。EventForm と揃えて `:00` を補完する。
        startTime: `${draftStart}:00`,
        endTime: `${draftEnd}:00`,
        projectId: draftProjectId || null,
        meetUrl: draftMeetUrl.trim() || null,
        description: draftBody,
      });
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存に失敗しました");
    } finally {
      setPending(false);
    }
  };

  const handleDelete = async () => {
    if (pending || !onDelete) return;
    if (!window.confirm(`イベント「${event.title}」を削除しますか?`)) return;
    setPending(true);
    setError(null);
    try {
      await onDelete(event.id);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "削除に失敗しました");
      setPending(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="イベント詳細"
      className="fixed inset-0 z-[200] flex flex-col"
    >
      <div onClick={onClose} className="absolute inset-0 bg-black/60 backdrop-blur-[4px]" />
      <div
        className="relative mt-auto flex max-h-[85vh] animate-panel-slide-up flex-col rounded-t-2xl bg-bg-surface"
        style={{
          borderTop: `2px solid ${evColor}40`,
        }}
      >
        <div className="flex justify-center px-0 pb-1 pt-2.5">
          <div className="h-[3px] w-8 rounded-[2px] bg-bg-divider" />
        </div>

        {!editing ? (
          <>
            <div className="px-5 pb-3 pt-2">
              <div className="mb-2 flex items-center gap-2">
                {proj && <div className="h-2 w-2 rounded-full" style={{ background: evColor }} />}
                {proj && <span className="font-jp text-[10px] text-fg-subtle">{proj.name}</span>}
                {isAllDay ? (
                  <span className="text-[10px] tabular-nums text-fg-weak">
                    <span
                      aria-label="終日"
                      className="mr-1.5 rounded-[3px] border border-bg-divider px-1.5 py-px font-jp text-[10px] text-fg-subtle"
                    >
                      終日
                    </span>
                    {formatAllDayRange(event)}
                  </span>
                ) : isDeadline ? (
                  <span
                    aria-label={`${formatClock(event.startTime)} 締切`}
                    className="text-[10px] tabular-nums text-fg-weak"
                  >
                    ⏰ {formatClock(event.startTime)}
                  </span>
                ) : (
                  <span className="text-[10px] tabular-nums text-fg-weak">
                    {formatClock(event.startTime)}–{formatClock(event.endTime)} (
                    {fmtDuration(duration)})
                  </span>
                )}
                {isGoogleCalendar && <GoogleCalendarBadge size="md" />}
                <div className="flex-1" />
                {canDelete ? (
                  <button
                    type="button"
                    onClick={handleDelete}
                    disabled={pending}
                    className="rounded-[4px] border border-accent-red/40 bg-transparent px-2.5 py-[3px] font-jp text-[10px] text-accent-red disabled:opacity-60"
                  >
                    削除
                  </button>
                ) : null}
                {canEdit ? (
                  <button
                    type="button"
                    onClick={startEdit}
                    disabled={pending}
                    className="rounded-[4px] border border-bg-divider bg-transparent px-2.5 py-[3px] font-jp text-[10px] text-fg-subtle disabled:opacity-60"
                  >
                    編集
                  </button>
                ) : null}
              </div>
              <h2 className="m-0 font-jp text-[16px] font-bold leading-[1.4] text-fg-strong">
                {event.title}
              </h2>
            </div>

            {event.meetUrl && (
              <div className="px-5 pb-2">
                <a
                  href={event.meetUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 font-jp text-[11px] no-underline ${
                    isZoom
                      ? "border border-[#2D8CFF30] bg-[#2D8CFF20] text-accent-zoomFg"
                      : "border border-[#00AC4730] bg-[#00AC4720] text-accent-meetFg"
                  }`}
                >
                  <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                    <path
                      d="M10 2H14V6"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                    <path
                      d="M14 2L8 8"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                    />
                    <path
                      d="M6 3H3V13H13V10"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                  {meetLabel}に参加
                </a>
              </div>
            )}

            {event.hasAttachments && (
              <div className="px-5 pb-2">
                <div className="flex items-center gap-1.5 rounded-[5px] bg-bg-elevated px-2.5 py-[5px] font-jp text-[11px] text-fg-muted">
                  <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                    <path
                      d="M9 2H4V14H12V5L9 2Z"
                      stroke="#52525b"
                      strokeWidth="1.2"
                      strokeLinejoin="round"
                    />
                    <path d="M9 2V5H12" stroke="#52525b" strokeWidth="1.2" strokeLinejoin="round" />
                  </svg>
                  添付資料あり
                </div>
              </div>
            )}

            {canEditProject && (
              <div className="px-5 pb-2">
                <div className="flex items-center gap-2">
                  <span className="font-jp text-[10px] text-fg-weak">プロジェクト</span>
                  {editingProject ? (
                    <select
                      autoFocus
                      value={event.projectId ?? ""}
                      onChange={(e) => {
                        const next = e.target.value === "" ? null : e.target.value;
                        onChangeProject!(event.id, next);
                        setEditingProject(false);
                      }}
                      onBlur={() => setEditingProject(false)}
                      className="flex-1 rounded border border-bg-divider bg-bg-elevated px-2 py-1 text-[11px] text-fg-default outline-none focus:border-accent-blue"
                    >
                      <option value="">なし</option>
                      {projects.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setEditingProject(true)}
                      className="cursor-pointer rounded-[4px] border border-bg-divider bg-transparent px-2 py-[3px] font-jp text-[10px] text-fg-subtle"
                    >
                      {proj ? proj.name : "未設定"} を変更
                    </button>
                  )}
                </div>
              </div>
            )}

            {canToggleVisibility ? (
              <div className="px-5 pb-2">
                <div className="flex items-center gap-2">
                  <span className="font-jp text-[10px] text-fg-weak">予定化</span>
                  <span
                    className={`rounded-[4px] border px-1.5 py-[1px] font-jp text-[10px] ${
                      effectiveShown
                        ? "border-accent-blue/40 text-accent-blue"
                        : "border-bg-divider text-fg-weak"
                    }`}
                  >
                    {effectiveShown ? "予定化中" : "予定化解除中"}
                    {overrideActive ? "" : "（自動）"}
                  </span>
                  <div className="flex-1" />
                  <button
                    type="button"
                    onClick={handleToggleVisibility}
                    disabled={visibilityPending}
                    className="rounded-[4px] border border-bg-divider bg-transparent px-2.5 py-[3px] font-jp text-[10px] text-fg-subtle disabled:opacity-60"
                  >
                    {effectiveShown ? "予定化解除" : "予定化する"}
                  </button>
                </div>
              </div>
            ) : null}

            {error ? (
              <div className="px-5 pb-2">
                <div
                  role="alert"
                  className="rounded bg-[#ef444420] px-2 py-1.5 text-[11px] text-accent-red"
                >
                  {error}
                </div>
              </div>
            ) : null}

            <div className="mx-5 h-px bg-bg-border" />

            <div className="flex-1 overflow-auto px-5 pb-6 pt-3">
              {event.description ? (
                <div>{renderMarkdown(event.description)}</div>
              ) : (
                <div className="py-5 text-center font-jp text-[12px] italic text-fg-faint">
                  詳細なし
                </div>
              )}
              {isGoogleCalendar && (
                <div className="mt-4 font-jp text-[10px] leading-[1.6] text-fg-faint">
                  Google Calendar で編集した内容は次回同期で反映されます
                </div>
              )}
            </div>
          </>
        ) : (
          <form onSubmit={submitEdit} className="flex flex-col gap-3 px-5 pb-6 pt-2">
            <label className="flex flex-col gap-1">
              <span className="font-jp text-[10px] text-fg-weak">タイトル</span>
              <input
                type="text"
                value={draftTitle}
                onChange={(e) => setDraftTitle(e.target.value)}
                autoFocus
                className="rounded border border-bg-divider bg-bg-elevated px-3 py-2 text-[13px] text-fg-default outline-none focus:border-accent-blue"
              />
            </label>

            <div className="flex gap-2">
              <label className="flex flex-1 flex-col gap-1">
                <span className="font-jp text-[10px] text-fg-weak">開始</span>
                <input
                  type="datetime-local"
                  value={draftStart}
                  onChange={(e) => setDraftStart(e.target.value)}
                  className="rounded border border-bg-divider bg-bg-elevated px-3 py-2 text-[13px] text-fg-default outline-none focus:border-accent-blue"
                />
              </label>
              <label className="flex flex-1 flex-col gap-1">
                <span className="font-jp text-[10px] text-fg-weak">終了</span>
                <input
                  type="datetime-local"
                  value={draftEnd}
                  onChange={(e) => setDraftEnd(e.target.value)}
                  className="rounded border border-bg-divider bg-bg-elevated px-3 py-2 text-[13px] text-fg-default outline-none focus:border-accent-blue"
                />
              </label>
            </div>

            <label className="flex flex-col gap-1">
              <span className="font-jp text-[10px] text-fg-weak">プロジェクト (任意)</span>
              <select
                value={draftProjectId}
                onChange={(e) => setDraftProjectId(e.target.value)}
                className="rounded border border-bg-divider bg-bg-elevated px-3 py-2 text-[13px] text-fg-default outline-none focus:border-accent-blue"
              >
                <option value="">なし</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-1">
              <span className="font-jp text-[10px] text-fg-weak">会議URL (任意)</span>
              <input
                type="url"
                value={draftMeetUrl}
                onChange={(e) => setDraftMeetUrl(e.target.value)}
                className="rounded border border-bg-divider bg-bg-elevated px-3 py-2 text-[13px] text-fg-default outline-none focus:border-accent-blue"
                placeholder="https://meet.google.com/..."
              />
            </label>

            <label className="flex flex-col gap-1">
              <span className="font-jp text-[10px] text-fg-weak">本文 (任意, Markdown)</span>
              <textarea
                value={draftBody}
                onChange={(e) => setDraftBody(e.target.value)}
                className="min-h-[120px] resize-y rounded border border-bg-divider bg-bg-elevated p-3 font-mono text-[12px] leading-[1.6] text-fg-default outline-none focus:border-accent-blue"
                placeholder="Markdownで詳細を入力..."
              />
            </label>

            {error ? (
              <div
                role="alert"
                className="rounded bg-[#ef444420] px-2 py-1.5 text-[11px] text-accent-red"
              >
                {error}
              </div>
            ) : null}

            <div className="mt-1 flex justify-end gap-2">
              <button
                type="button"
                onClick={cancelEdit}
                className="rounded border border-bg-divider bg-transparent px-3 py-1.5 font-jp text-[11px] text-fg-subtle"
              >
                キャンセル
              </button>
              <button
                type="submit"
                disabled={pending}
                className="rounded bg-accent-blue px-4 py-1.5 font-jp text-[11px] font-semibold text-fg-invert disabled:opacity-60"
              >
                {pending ? "保存中..." : "保存"}
              </button>
            </div>
          </form>
        )}
      </div>
      {scopeModalOpen ? (
        <RecurringScopeModal
          targetValue={pendingTargetValue}
          pending={visibilityPending}
          onSelect={handleScopeSelect}
          onClose={() => setScopeModalOpen(false)}
        />
      ) : null}
    </div>
  );
}

/**
 * Issue #229 / ADR 0056 §6: recurring event の予定化 / 解除を選んだ時に出す 3 択 modal。
 *
 * - default は `single` (ADR 0056 §6)。系列影響は明示選択でしか発生させない。
 * - `role="dialog"` + `aria-modal` + `aria-labelledby` で a11y 構造を立てる。
 * - 操作中 (pending) は全ボタンを disabled にして連打を防ぐ。
 * - ESC / オーバーレイクリックで閉じる (キャンセル相当)。
 */
function RecurringScopeModal({
  targetValue,
  pending,
  onSelect,
  onClose,
}: {
  targetValue: "shown" | "hidden";
  pending: boolean;
  onSelect: (scope: EventVisibilityOverrideScope) => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !pending) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, pending]);

  const titleId = "event-recurring-scope-title";
  const verb = targetValue === "shown" ? "予定化" : "予定化解除";
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      className="fixed inset-0 z-[210] flex items-center justify-center"
    >
      <div
        onClick={pending ? undefined : onClose}
        className="absolute inset-0 bg-black/60 backdrop-blur-[4px]"
      />
      <div className="relative w-[min(420px,calc(100vw-32px))] rounded-lg border border-bg-divider bg-bg-elevated p-5 shadow-xl">
        <h3 id={titleId} className="m-0 font-jp text-[13px] font-semibold text-fg-strong">
          繰り返し予定の{verb}
        </h3>
        <p className="mt-2 text-[11px] leading-relaxed text-fg-muted">
          この予定は繰り返しの一部です。どの範囲に{verb}を適用しますか?
        </p>
        <div className="mt-4 flex flex-col gap-2">
          <button
            type="button"
            disabled={pending}
            onClick={() => onSelect("single")}
            className="rounded-md border border-accent-blue/60 bg-accent-blue/10 px-3 py-2 text-left font-jp text-[12px] text-fg-emphasized disabled:opacity-60"
          >
            <span className="block font-semibold">この予定だけ</span>
            <span className="mt-0.5 block text-[10px] text-fg-muted">
              選択した回のみに{verb}を適用します。
            </span>
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => onSelect("this_and_following")}
            className="rounded-md border border-bg-divider bg-bg-primary px-3 py-2 text-left font-jp text-[12px] text-fg-emphasized disabled:opacity-60"
          >
            <span className="block font-semibold">これ以降の予定もまとめて</span>
            <span className="mt-0.5 block text-[10px] text-fg-muted">
              この回以降の繰り返しすべてに{verb}を適用します。
            </span>
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => onSelect("all")}
            className="rounded-md border border-bg-divider bg-bg-primary px-3 py-2 text-left font-jp text-[12px] text-fg-emphasized disabled:opacity-60"
          >
            <span className="block font-semibold">すべての繰り返し</span>
            <span className="mt-0.5 block text-[10px] text-fg-muted">
              過去・未来を含む全ての回に{verb}を適用します。
            </span>
          </button>
        </div>
        <div className="mt-4 flex justify-end">
          <button
            type="button"
            disabled={pending}
            onClick={onClose}
            className="rounded border border-bg-divider bg-transparent px-3 py-1.5 font-jp text-[11px] text-fg-subtle disabled:opacity-60"
          >
            キャンセル
          </button>
        </div>
      </div>
    </div>
  );
}
