"use client";

import { useState } from "react";

import type { CreateEventInput } from "@/entities/event/api";
import type { Project } from "@/entities/project/types";
import { todayIso } from "@/shared/lib/time";

type EventFormProps = {
  projects: readonly Project[];
  onSubmit: (input: CreateEventInput) => Promise<void>;
  onClose: () => void;
};

/**
 * Phase 1 仕様 Step 3「イベント追加フォーム（タイトル、開始-終了時刻、会議URL、プロジェクト）」。
 * 時刻は `<input type="datetime-local">` を使い、ローカル時刻を ISO 8601 風に送る。
 */
export function EventForm({ projects, onSubmit, onClose }: EventFormProps) {
  const [title, setTitle] = useState("");
  const [startLocal, setStartLocal] = useState<string>(`${todayIso()}T09:00`);
  const [endLocal, setEndLocal] = useState<string>(`${todayIso()}T10:00`);
  const [projectId, setProjectId] = useState<string>("");
  const [meetUrl, setMeetUrl] = useState<string>("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pending) return;
    if (!title.trim()) {
      setError("タイトルは必須です");
      return;
    }
    if (!startLocal || !endLocal) {
      setError("開始/終了時刻は必須です");
      return;
    }
    if (new Date(endLocal).getTime() <= new Date(startLocal).getTime()) {
      setError("終了時刻は開始時刻より後にしてください");
      return;
    }
    setPending(true);
    setError(null);
    try {
      await onSubmit({
        title: title.trim(),
        // datetime-local の値は tz なしローカル時刻。`:00` を補完して DB の timestamptz に渡す。
        startTime: `${startLocal}:00`,
        endTime: `${endLocal}:00`,
        projectId: projectId || null,
        meetUrl: meetUrl.trim() || null,
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
          placeholder="例: SLOレビューMTG"
        />
      </label>

      <div className="flex gap-2">
        <label className="flex flex-1 flex-col gap-1">
          <span className="font-jp text-[10px] text-fg-weak">開始</span>
          <input
            type="datetime-local"
            value={startLocal}
            onChange={(e) => setStartLocal(e.target.value)}
            className="rounded border border-bg-divider bg-bg-elevated px-3 py-2 text-[13px] text-fg-default outline-none focus:border-accent-blue"
          />
        </label>
        <label className="flex flex-1 flex-col gap-1">
          <span className="font-jp text-[10px] text-fg-weak">終了</span>
          <input
            type="datetime-local"
            value={endLocal}
            onChange={(e) => setEndLocal(e.target.value)}
            className="rounded border border-bg-divider bg-bg-elevated px-3 py-2 text-[13px] text-fg-default outline-none focus:border-accent-blue"
          />
        </label>
      </div>

      <label className="flex flex-col gap-1">
        <span className="font-jp text-[10px] text-fg-weak">プロジェクト (任意)</span>
        <select
          value={projectId}
          onChange={(e) => setProjectId(e.target.value)}
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
          value={meetUrl}
          onChange={(e) => setMeetUrl(e.target.value)}
          className="rounded border border-bg-divider bg-bg-elevated px-3 py-2 text-[13px] text-fg-default outline-none focus:border-accent-blue"
          placeholder="https://meet.google.com/..."
        />
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
