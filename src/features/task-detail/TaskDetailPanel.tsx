import { useMemo, useState } from "react";
import type { LatestDecomposeLog } from "../../entities/action-log/gateway";
import type { DecomposeFailReason } from "../../entities/action-log/types";
import type { Event } from "../../entities/event/types";
import { getProject } from "../../entities/project/projects";
import { useProjects } from "../../entities/project/ProjectsContext";
import type { Task, TaskCategory } from "../../entities/task/types";
import { renderMarkdown } from "../../shared/lib/markdown";
import { isDone } from "../../shared/lib/task";
import { fmtDuration, formatRelativeTime } from "../../shared/lib/time";
import { TASK_CATEGORY_VALUES } from "../../shared/types/database";

export type TaskDetailPanelProps = {
  task: Task;
  events: Event[];
  /** 現在時刻 (ms)。依存イベントの相対時刻 / 候補絞り込みに使う。省略時は呼び出し時刻。 */
  now?: number;
  onClose: () => void;
  onUpdate: (id: string, body: string) => void;
  onToggleDone: (id: string) => void;
  onDelete?: (id: string) => void;
  /**
   * 依存イベント (`tasks.depends_on_event_id`) の更新。null は「依存なし」。
   * 未指定なら依存編集 UI も表示しない (テストや特殊呼び出しで省略可)。
   */
  onChangeDependency?: (id: string, eventId: string | null) => void;
  /**
   * `tasks.task_category` の override (ADR 0015 / #90)。AI 初期ラベルに対する
   * 人間の override で、暗黙的フィードバックとして `task_category_changed`
   * action_log に残る (logging は呼び出し側 = AppShell の責務)。
   * 未指定なら category 編集 UI を出さない (旧呼び出し / テスト互換)。
   */
  onChangeCategory?: (id: string, category: TaskCategory | null) => void;
  /**
   * AI 分解の最新試行ログ (`task_decomposed` / `task_decompose_failed` /
   * `task_decompose_skipped` の最新 1 件)。なければ null。
   * 親が undefined を渡した場合は AI 分解情報エリアを描画しない (旧呼び出し互換)。
   */
  latestDecomposeLog?: LatestDecomposeLog | null;
  /** action_log fetch 中フラグ。spinner 表示判定に使う。 */
  isDecomposeLogLoading?: boolean;
  /** AI_ENABLED kill-switch。false のとき「AI 分解を実行」/「再実行」を disable する (ADR 0021)。 */
  aiEnabled?: boolean;
  /** 「AI 分解を実行」/「再実行」押下時の callback。fire-and-forget で server に投げる。 */
  onTriggerDecompose?: (id: string) => void;
};

export function TaskDetailPanel({
  task,
  events,
  now,
  onClose,
  onUpdate,
  onToggleDone,
  onDelete,
  onChangeDependency,
  onChangeCategory,
  latestDecomposeLog,
  isDecomposeLogLoading,
  aiEnabled = true,
  onTriggerDecompose,
}: TaskDetailPanelProps) {
  const { projectsById } = useProjects();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(task.body || "");
  const [editingDep, setEditingDep] = useState(false);
  const [editingCategory, setEditingCategory] = useState(false);
  // パネル open 時刻を「今」として固定する。パネル中に分跨ぎしても候補や相対時刻が
  // ばたつかないようにするのが目的 (相対時刻はあくまで判断補助)。
  const [openedAt] = useState<number>(() => now ?? Date.now());
  const nowMs = now && now > 0 ? now : openedAt;
  const nowDate = useMemo(() => new Date(nowMs), [nowMs]);
  const proj = getProject(projectsById, task.projectId);
  const dep = task.dependsOnEventId ? events.find((e) => e.id === task.dependsOnEventId) : null;
  const done = isDone(task);

  // 依存先候補は「未来のイベント + 現在選択中のイベント (過去でも保持表示)」。
  // 過去のイベントを新規依存先にしても意味がないが、既存の依存先を勝手に外すと混乱するため残す。
  const depCandidates = useMemo(() => {
    const future = events.filter((ev) => new Date(ev.startTime).getTime() >= nowMs);
    const includesCurrent = dep ? future.some((ev) => ev.id === dep.id) : true;
    const merged = includesCurrent && dep ? future : dep ? [dep, ...future] : future;
    return [...merged].sort(
      (a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime(),
    );
  }, [events, dep, nowMs]);

  const handleSave = () => {
    onUpdate(task.id, draft);
    setEditing(false);
  };

  const showDecomposeSection = latestDecomposeLog !== undefined || onTriggerDecompose !== undefined;

  return (
    <div className="fixed inset-0 z-[200] flex flex-col">
      <div onClick={onClose} className="absolute inset-0 bg-black/60 backdrop-blur-[4px]" />

      <div
        className="relative mt-auto flex max-h-[85vh] animate-panel-slide-up flex-col rounded-t-2xl bg-bg-surface"
        style={{
          borderTop: `2px solid ${proj.color}40`,
        }}
      >
        <div className="flex justify-center px-0 pb-1 pt-2.5">
          <div className="h-[3px] w-8 rounded-[2px] bg-bg-divider" />
        </div>

        <div className="px-5 pb-3 pt-2">
          <div className="mb-2 flex items-center gap-2">
            <div className="h-2 w-2 rounded-full" style={{ background: proj.color }} />
            <span className="font-jp text-[10px] text-fg-subtle">{proj.name}</span>
            {task.estimatedMinutes !== null && (
              <span className="text-[9px] tabular-nums text-fg-faint">
                {fmtDuration(task.estimatedMinutes)}
              </span>
            )}
            {dep && (
              <span className="rounded-[3px] bg-[#E85D0415] px-1.5 py-px font-jp text-[9px] text-accent-amber">
                ← {formatRelativeTime(dep.startTime, nowDate)} {dep.title}
              </span>
            )}
            <div className="flex-1" />
            <button
              onClick={() => {
                onToggleDone(task.id);
                onClose();
              }}
              className="cursor-pointer rounded-[4px] px-2.5 py-[3px] font-jp text-[10px]"
              style={{
                background: done ? "#27272a" : proj.color,
                color: done ? "#8B949E" : "#fff",
              }}
            >
              {done ? "未完了に戻す" : "完了にする"}
            </button>
          </div>
          <h2 className="m-0 font-jp text-[16px] font-bold leading-[1.4] text-fg-strong">
            {task.title}
          </h2>
        </div>

        {onChangeDependency && (
          <div className="px-5 pb-2">
            <div className="flex items-center gap-2">
              <span className="font-jp text-[10px] text-fg-weak">依存イベント</span>
              {editingDep ? (
                <select
                  autoFocus
                  value={task.dependsOnEventId ?? ""}
                  onChange={(e) => {
                    const next = e.target.value === "" ? null : e.target.value;
                    onChangeDependency(task.id, next);
                    setEditingDep(false);
                  }}
                  onBlur={() => setEditingDep(false)}
                  className="flex-1 rounded border border-bg-divider bg-bg-elevated px-2 py-1 text-[11px] text-fg-default outline-none focus:border-accent-blue"
                >
                  <option value="">なし</option>
                  {depCandidates.map((ev) => (
                    <option key={ev.id} value={ev.id}>
                      {formatRelativeTime(ev.startTime, nowDate)} {ev.title}
                    </option>
                  ))}
                </select>
              ) : (
                <button
                  type="button"
                  onClick={() => setEditingDep(true)}
                  className="cursor-pointer rounded-[4px] border border-bg-divider bg-transparent px-2 py-[3px] font-jp text-[10px] text-fg-subtle"
                >
                  {dep ? `${formatRelativeTime(dep.startTime, nowDate)} ${dep.title}` : "なし"}{" "}
                  を変更
                </button>
              )}
            </div>
          </div>
        )}

        {onChangeCategory && (
          <div className="px-5 pb-2">
            <div className="flex items-center gap-2">
              <span className="font-jp text-[10px] text-fg-weak">タスク種類</span>
              {editingCategory ? (
                <select
                  autoFocus
                  value={task.taskCategory ?? ""}
                  onChange={(e) => {
                    const raw = e.target.value;
                    const next = raw === "" ? null : (raw as TaskCategory);
                    if (next !== (task.taskCategory ?? null)) {
                      onChangeCategory(task.id, next);
                    }
                    setEditingCategory(false);
                  }}
                  onBlur={() => setEditingCategory(false)}
                  className="flex-1 rounded border border-bg-divider bg-bg-elevated px-2 py-1 text-[11px] text-fg-default outline-none focus:border-accent-blue"
                >
                  <option value="">未分類</option>
                  {TASK_CATEGORY_VALUES.map((value) => (
                    <option key={value} value={value}>
                      {TASK_CATEGORY_LABELS[value]}
                    </option>
                  ))}
                </select>
              ) : (
                <button
                  type="button"
                  onClick={() => setEditingCategory(true)}
                  className="cursor-pointer rounded-[4px] border border-bg-divider bg-transparent px-2 py-[3px] font-jp text-[10px] text-fg-subtle"
                >
                  {task.taskCategory ? TASK_CATEGORY_LABELS[task.taskCategory] : "未分類"} を変更
                </button>
              )}
            </div>
          </div>
        )}

        {showDecomposeSection && (
          <DecomposeInfoSection
            task={task}
            log={latestDecomposeLog}
            isLoading={isDecomposeLogLoading ?? false}
            aiEnabled={aiEnabled}
            onTriggerDecompose={onTriggerDecompose}
          />
        )}

        <div className="mx-5 h-px bg-bg-border" />

        <div className="flex-1 overflow-auto px-5 pb-6 pt-3">
          {!editing ? (
            <>
              <div className="mb-2 flex justify-end gap-2">
                {onDelete ? (
                  <button
                    onClick={() => {
                      if (window.confirm("このタスクを削除しますか?")) {
                        onDelete(task.id);
                        onClose();
                      }
                    }}
                    className="flex cursor-pointer items-center gap-1 rounded-[4px] border border-bg-divider bg-transparent px-2.5 py-[3px] text-[10px] text-accent-red"
                  >
                    削除
                  </button>
                ) : null}
                <button
                  onClick={() => {
                    setDraft(task.body || "");
                    setEditing(true);
                  }}
                  className="flex cursor-pointer items-center gap-1 rounded-[4px] border border-bg-divider bg-transparent px-2.5 py-[3px] text-[10px] text-fg-subtle"
                >
                  <svg width="10" height="10" viewBox="0 0 16 16" fill="none">
                    <path
                      d="M11.5 1.5L14.5 4.5 5 14H2V11L11.5 1.5Z"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinejoin="round"
                    />
                  </svg>
                  編集
                </button>
              </div>
              {task.body ? (
                <div>{renderMarkdown(task.body)}</div>
              ) : (
                <div className="py-5 text-center font-jp text-[12px] italic text-fg-faint">
                  詳細を追加...
                </div>
              )}
            </>
          ) : (
            <>
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                autoFocus
                className="min-h-[200px] w-full resize-y rounded-lg border border-bg-divider bg-bg-elevated p-3 font-mono text-[12px] leading-[1.6] text-fg-default outline-none"
                placeholder="Markdownで詳細を入力..."
                onFocus={(e) => {
                  e.target.style.borderColor = proj.color + "60";
                }}
                onBlur={(e) => {
                  e.target.style.borderColor = "#27272a";
                }}
              />
              <div className="mt-2.5 flex justify-end gap-2">
                <button
                  onClick={() => setEditing(false)}
                  className="cursor-pointer rounded-[4px] border border-bg-divider bg-transparent px-3.5 py-1 font-jp text-[10px] text-fg-subtle"
                >
                  キャンセル
                </button>
                <button
                  onClick={handleSave}
                  className="cursor-pointer rounded-[4px] px-3.5 py-1 font-jp text-[10px] font-semibold text-fg-invert"
                  style={{ background: proj.color }}
                >
                  保存
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * AI 分解情報エリア (P3-15 / ADR 0021 §3)。
 * `decompose_status` 別に状態 / recovery ボタン / raw response を出し分ける。
 */
function DecomposeInfoSection({
  task,
  log,
  isLoading,
  aiEnabled,
  onTriggerDecompose,
}: {
  task: Task;
  log: LatestDecomposeLog | null | undefined;
  isLoading: boolean;
  aiEnabled: boolean;
  onTriggerDecompose: ((id: string) => void) | undefined;
}) {
  const status = task.decomposeStatus;
  const canTrigger = (status === "none" || status === "failed") && onTriggerDecompose !== undefined;
  const buttonLabel = status === "failed" ? "再実行" : "AI 分解を実行";

  // raw_response が期待される状態 (decomposed / skipped / failed)。
  // none / decomposing は終端 log を持たないので raw 表示自体を出さない。
  const showLogArea = status === "decomposed" || status === "skipped" || status === "failed";

  return (
    <section aria-label="AI 分解情報" className="px-5 pb-2 pt-1">
      <div className="mb-1 font-jp text-[10px] text-fg-weak">AI 分解</div>
      <div className="flex flex-wrap items-center gap-2">
        <DecomposeStatusLabel status={status} log={log} />
        {canTrigger && onTriggerDecompose ? (
          <button
            type="button"
            onClick={() => onTriggerDecompose(task.id)}
            disabled={!aiEnabled}
            className="cursor-pointer rounded-[4px] border border-bg-divider bg-transparent px-2.5 py-[3px] font-jp text-[10px] text-fg-subtle disabled:cursor-not-allowed disabled:opacity-50"
          >
            {buttonLabel}
          </button>
        ) : null}
      </div>
      {showLogArea ? (
        <div className="mt-2">
          {isLoading ? (
            <span role="status" className="font-jp text-[10px] text-fg-faint">
              読み込み中…
            </span>
          ) : log === null || log === undefined ? (
            <span className="font-jp text-[10px] text-fg-faint">履歴なし</span>
          ) : (
            <RawResponseDetails log={log} />
          )}
        </div>
      ) : null}
    </section>
  );
}

function DecomposeStatusLabel({
  status,
  log,
}: {
  status: Task["decomposeStatus"];
  log: LatestDecomposeLog | null | undefined;
}) {
  if (status === "decomposing") {
    return (
      <span
        role="status"
        aria-live="polite"
        className="inline-flex items-center gap-1 rounded-[3px] bg-accent-blue/15 px-1.5 py-px font-jp text-[10px] text-accent-blue"
      >
        <span className="h-1 w-1 animate-pulse rounded-full bg-accent-blue" aria-hidden="true" />
        分解中…
      </span>
    );
  }
  if (status === "decomposed") {
    const childCount =
      log?.action_type === "task_decomposed" ? log.metadata.child_ids.length : null;
    return (
      <span className="rounded-[3px] bg-fg-weak/10 px-1.5 py-px font-jp text-[10px] text-fg-subtle">
        {childCount !== null ? `分解完了（子タスク ${childCount} 件）` : "分解完了"}
      </span>
    );
  }
  if (status === "skipped") {
    return (
      <span className="rounded-[3px] bg-fg-weak/15 px-1.5 py-px font-jp text-[10px] text-fg-weak">
        AI が分解不要と判断
      </span>
    );
  }
  if (status === "failed") {
    const reason = log?.action_type === "task_decompose_failed" ? log.metadata.reason : null;
    return (
      <span
        role="alert"
        className="rounded-[3px] bg-accent-red/15 px-1.5 py-px font-jp text-[10px] text-accent-red"
      >
        {reason ? `分解失敗 — ${failedReasonText(reason)}` : "分解失敗"}
      </span>
    );
  }
  // status === "none"
  return (
    <span className="rounded-[3px] bg-fg-weak/10 px-1.5 py-px font-jp text-[10px] text-fg-faint">
      AI 分解未試行
    </span>
  );
}

function RawResponseDetails({ log }: { log: LatestDecomposeLog }) {
  const raw = rawResponseFromLog(log);
  if (raw === null || raw.length === 0) {
    return <span className="font-jp text-[10px] text-fg-faint">AI 応答なし</span>;
  }
  return (
    <details className="font-jp text-[10px] text-fg-subtle">
      <summary className="cursor-pointer select-none text-fg-weak">AI 応答を表示</summary>
      <pre className="mt-1 whitespace-pre-wrap rounded border border-bg-divider bg-bg-elevated p-2 font-mono text-[10px] leading-[1.5] text-fg-default">
        {raw}
      </pre>
    </details>
  );
}

function rawResponseFromLog(log: LatestDecomposeLog): string | null {
  if (log.action_type === "task_decomposed") return log.metadata.raw_response;
  if (log.action_type === "task_decompose_skipped") return log.metadata.raw_response;
  // task_decompose_failed: raw_response は generate が応答を返した後に失敗した場合のみ存在
  return log.metadata.raw_response ?? null;
}

// ADR 0015 / #90: タスク種類 override の表示ラベル。値域 (TASK_CATEGORY_VALUES) は
// DB の CHECK と single source of truth で揃え、ここでは表示用の和訳のみ持つ。
const TASK_CATEGORY_LABELS: Record<TaskCategory, string> = {
  coding: "コーディング",
  doc: "ドキュメント",
  research: "調査",
  admin: "事務",
  other: "その他",
};

const FAIL_REASON_MESSAGES: Record<DecomposeFailReason, string> = {
  quota_exhausted: "AI のクォータ上限に達しました。時間をおいて再実行してください",
  upstream_unavailable: "AI サービスに一時的に接続できませんでした",
  ai_response_unparseable: "AI の応答を解釈できませんでした",
  insert_failed: "タスクの保存に失敗しました",
  internal_error: "予期しないエラーが発生しました",
};

function failedReasonText(reason: DecomposeFailReason): string {
  return FAIL_REASON_MESSAGES[reason];
}
