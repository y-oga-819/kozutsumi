"use client";

import { useState } from "react";

import type { CreateTaskInput } from "@/entities/task/api";
import type { Event } from "@/entities/event/types";
import type { Project } from "@/entities/project/types";
import { formatClock } from "@/shared/lib/time";

type TaskFormProps = {
  projects: readonly Project[];
  events: readonly Event[];
  onSubmit: (input: CreateTaskInput) => Promise<void>;
  onClose: () => void;
};

/**
 * Phase 1 仕様 Step 3「タスク追加フォーム（タイトル、プロジェクト選択、見積もり時間）」。
 * 依存イベントも任意で選べるようにしてある (feature-spec.md: event-gated タスク)。
 */
export function TaskForm({ projects, events, onSubmit, onClose }: TaskFormProps) {
  const [title, setTitle] = useState("");
  const [projectId, setProjectId] = useState<string>(projects[0]?.id ?? "");
  const [minutes, setMinutes] = useState<string>("");
  const [dependsOnEventId, setDependsOnEventId] = useState<string>("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pending) return;
    if (!title.trim()) {
      setError("タイトルは必須です");
      return;
    }
    if (!projectId) {
      setError("プロジェクトを選んでください");
      return;
    }
    setPending(true);
    setError(null);
    try {
      const estimated = minutes.trim() === "" ? null : Number(minutes);
      if (estimated !== null && (!Number.isFinite(estimated) || estimated <= 0)) {
        setError("見積もり分数は正の整数で指定してください");
        setPending(false);
        return;
      }
      await onSubmit({
        projectId,
        title: title.trim(),
        estimatedMinutes: estimated,
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
        <span className="font-jp text-[10px] text-fg-weak">プロジェクト</span>
        <select
          value={projectId}
          onChange={(e) => setProjectId(e.target.value)}
          className="rounded border border-bg-divider bg-bg-elevated px-3 py-2 text-[13px] text-fg-default outline-none focus:border-accent-blue"
        >
          {projects.length === 0 ? (
            <option value="">プロジェクトがありません</option>
          ) : null}
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1">
        <span className="font-jp text-[10px] text-fg-weak">見積もり (分)</span>
        <input
          type="number"
          min="1"
          value={minutes}
          onChange={(e) => setMinutes(e.target.value)}
          className="rounded border border-bg-divider bg-bg-elevated px-3 py-2 text-[13px] text-fg-default outline-none focus:border-accent-blue"
          placeholder="45"
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="font-jp text-[10px] text-fg-weak">依存イベント (任意)</span>
        <select
          value={dependsOnEventId}
          onChange={(e) => setDependsOnEventId(e.target.value)}
          className="rounded border border-bg-divider bg-bg-elevated px-3 py-2 text-[13px] text-fg-default outline-none focus:border-accent-blue"
        >
          <option value="">なし</option>
          {events.map((ev) => (
            <option key={ev.id} value={ev.id}>
              {formatClock(ev.startTime)} {ev.title}
            </option>
          ))}
        </select>
      </label>

      {error ? (
        <div className="rounded bg-[#ef444420] px-2 py-1.5 text-[11px] text-accent-red">
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
