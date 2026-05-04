"use client";

import { useMemo, useState } from "react";

import type { CreateTaskInput } from "@/entities/task/gateway";
import { TASK_SIZE_LABELS } from "@/entities/task/task-size";
import type { Event } from "@/entities/event/types";
import type { Project } from "@/entities/project/types";
import { formatRelativeTime } from "@/shared/lib/time";
import { TASK_SIZE_VALUES, type TaskSizeValue } from "@/shared/types/database";

type TaskFormProps = {
  projects: readonly Project[];
  events: readonly Event[];
  onSubmit: (input: CreateTaskInput) => Promise<void>;
  onClose: () => void;
};

/**
 * #170 / ADR 0036 / 0037 / 0038 / 0039: シンプル世界観の単一登録経路。
 *
 * - title 必須
 * - body は任意 (ADR 0037 の AI 分解 prompt 入力 / 「秘書から相談」モードの起点)
 * - task_size 必須 7 段階 (ADR 0038 の主観サイズ。AI 推定 estimated_minutes とは別軸)
 * - project は任意 (ADR 0039 で後付け / 伝播 RPC 経由で修正可能になる前提)
 * - estimated_minutes は登録時に取らない。AI 分解 / 補正の責務に倒す
 */
export function TaskForm({ projects, events, onSubmit, onClose }: TaskFormProps) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [projectId, setProjectId] = useState<string>("");
  const [taskSize, setTaskSize] = useState<TaskSizeValue | null>(null);
  const [dependsOnEventId, setDependsOnEventId] = useState<string>("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // フォーム open 時刻を「今」として固定する。フォーム滞在中に分跨ぎしても候補が
  // ばたつかないようにする。manual / google_calendar 両対応。
  const [openedAt] = useState<number>(() => Date.now());

  // 依存イベントは「未来 (現在時刻以降に開始する)」イベントのみを候補に出す。
  // 過去のイベントを依存先に新規設定しても意味がないため。
  const futureEvents = useMemo(() => {
    return [...events]
      .filter((ev) => new Date(ev.startTime).getTime() >= openedAt)
      .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
  }, [events, openedAt]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pending) return;
    if (!title.trim()) {
      setError("タイトルは必須です");
      return;
    }
    if (taskSize === null) {
      setError("サイズを選んでください");
      return;
    }
    setPending(true);
    setError(null);
    try {
      await onSubmit({
        projectId: projectId || null,
        title: title.trim(),
        body: body.trim() || undefined,
        taskSize,
        dependsOnEventId: dependsOnEventId || null,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存に失敗しました");
      setPending(false);
    }
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <label className="flex flex-col gap-1">
        <span className="font-jp text-[10px] text-fg-weak">タイトル</span>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          autoFocus
          className="rounded border border-bg-divider bg-bg-elevated px-3 py-2 text-[13px] text-fg-default outline-none focus:border-accent-blue"
          placeholder="例: 面接対策"
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="font-jp text-[10px] text-fg-weak">詳細 (任意)</span>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={3}
          className="resize-y rounded border border-bg-divider bg-bg-elevated px-3 py-2 font-mono text-[12px] leading-[1.5] text-fg-default outline-none focus:border-accent-blue"
          placeholder="背景 / 進め方 / 完了条件など。AI 分解の文脈になります"
        />
      </label>

      <fieldset className="flex flex-col gap-1">
        <legend className="font-jp text-[10px] text-fg-weak">サイズ</legend>
        <div role="radiogroup" aria-label="サイズ" className="flex flex-wrap gap-1.5">
          {TASK_SIZE_VALUES.map((value) => {
            const selected = taskSize === value;
            return (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => setTaskSize(value)}
                className={`rounded border px-2.5 py-1 font-jp text-[11px] ${
                  selected
                    ? "border-accent-blue bg-accent-blue/15 text-accent-blue"
                    : "border-bg-divider bg-bg-elevated text-fg-subtle hover:border-fg-faint"
                }`}
              >
                {TASK_SIZE_LABELS[value]}
              </button>
            );
          })}
        </div>
      </fieldset>

      <label className="flex flex-col gap-1">
        <span className="font-jp text-[10px] text-fg-weak">プロジェクト (任意)</span>
        <select
          value={projectId}
          onChange={(e) => setProjectId(e.target.value)}
          className="rounded border border-bg-divider bg-bg-elevated px-3 py-2 text-[13px] text-fg-default outline-none focus:border-accent-blue"
        >
          <option value="">未指定 (後で決める)</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1">
        <span className="font-jp text-[10px] text-fg-weak">依存イベント (任意)</span>
        <select
          value={dependsOnEventId}
          onChange={(e) => setDependsOnEventId(e.target.value)}
          className="rounded border border-bg-divider bg-bg-elevated px-3 py-2 text-[13px] text-fg-default outline-none focus:border-accent-blue"
        >
          <option value="">なし</option>
          {futureEvents.map((ev) => (
            <option key={ev.id} value={ev.id}>
              {formatRelativeTime(ev.startTime, new Date(openedAt))} {ev.title}
            </option>
          ))}
        </select>
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
          onClick={onClose}
          className="rounded border border-bg-divider bg-transparent px-3 py-1.5 font-jp text-[11px] text-fg-subtle"
        >
          キャンセル
        </button>
        <button
          type="submit"
          disabled={pending}
          className="rounded bg-accent-blue px-4 py-1.5 font-jp text-[11px] font-semibold text-fg-invert disabled:opacity-60"
        >
          {pending ? "保存中..." : "追加"}
        </button>
      </div>
    </form>
  );
}
