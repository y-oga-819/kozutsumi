"use client";

import { useState } from "react";

import type { UpdateProjectInput } from "@/entities/project/gateway";
import type { Project } from "@/entities/project/types";

type ProjectDetailPanelProps = {
  project: Project;
  onClose: () => void;
  onUpdate: (id: string, patch: UpdateProjectInput) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
};

const DEFAULT_COLORS = ["#E85D04", "#0096C7", "#2D9F45", "#9B5DE5", "#58A6FF", "#EF4444"];

/**
 * Issue #75: 既存プロジェクトの編集 / 削除パネル。
 * 削除時の cascade (tasks.project_id / events.project_id を null) は schema 側
 * `ON DELETE SET NULL` で担当する。UI は AppShell 側で tasks / events query を
 * invalidate するだけでよい。
 */
export function ProjectDetailPanel({
  project,
  onClose,
  onUpdate,
  onDelete,
}: ProjectDetailPanelProps) {
  const [name, setName] = useState(project.name);
  const [color, setColor] = useState(project.color);
  const [isPrimary, setIsPrimary] = useState(project.isPrimary);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pending) return;
    if (!name.trim()) {
      setError("名前は必須です");
      return;
    }
    setPending(true);
    setError(null);
    try {
      await onUpdate(project.id, { name: name.trim(), color, isPrimary });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存に失敗しました");
      setPending(false);
    }
  };

  const handleDelete = async () => {
    if (pending) return;
    if (
      !window.confirm(
        `プロジェクト「${project.name}」を削除しますか?\n紐付くタスク・イベントの所属は外れます。`,
      )
    ) {
      return;
    }
    setPending(true);
    setError(null);
    try {
      await onDelete(project.id);
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
      aria-label="プロジェクト編集"
      className="fixed inset-0 z-[230] flex flex-col"
    >
      <div onClick={onClose} className="absolute inset-0 bg-black/60 backdrop-blur-[4px]" />
      <div
        className="relative mt-auto flex max-h-[85vh] animate-panel-slide-up flex-col rounded-t-2xl bg-bg-surface"
        style={{ borderTop: `2px solid ${color}40` }}
      >
        <div className="flex justify-center pb-1 pt-2.5">
          <div className="h-[3px] w-8 rounded-[2px] bg-bg-divider" />
        </div>

        <div className="flex justify-end px-5 pt-1">
          {/* 削除はパネル下端ではなく上部に置く。下端は Next.js dev mode の
              ビルドインジケータ (<nextjs-portal>) と重なって e2e の click が
              吸われるのと、TaskDetailPanel と整合させる目的。 */}
          <button
            type="button"
            onClick={handleDelete}
            disabled={pending}
            className="rounded border border-accent-red/40 bg-transparent px-3 py-1 font-jp text-[10px] text-accent-red disabled:opacity-60"
          >
            削除
          </button>
        </div>

        <form onSubmit={submit} className="flex flex-col gap-3 px-5 pb-6 pt-2">
          <label className="flex flex-col gap-1">
            <span className="font-jp text-[10px] text-fg-weak">名前</span>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
              className="rounded border border-bg-divider bg-bg-elevated px-3 py-2 text-[13px] text-fg-default outline-none focus:border-accent-blue"
            />
          </label>

          <div className="flex flex-col gap-1">
            <span className="font-jp text-[10px] text-fg-weak">色</span>
            <div className="flex flex-wrap gap-2">
              {DEFAULT_COLORS.map((c) => (
                <button
                  type="button"
                  key={c}
                  onClick={() => setColor(c)}
                  className={`h-7 w-7 rounded-full transition-all ${
                    color === c ? "ring-2 ring-offset-2 ring-offset-bg-primary" : ""
                  }`}
                  style={{ background: c, boxShadow: color === c ? `0 0 0 2px ${c}` : undefined }}
                  aria-label={c}
                />
              ))}
              <label className="flex h-7 w-7 cursor-pointer items-center justify-center overflow-hidden rounded-full border border-bg-divider">
                <input
                  type="color"
                  value={color}
                  onChange={(e) => setColor(e.target.value)}
                  className="h-10 w-10 cursor-pointer border-0 bg-transparent p-0"
                />
              </label>
            </div>
          </div>

          <label className="flex items-center gap-2 font-jp text-[11px] text-fg-muted">
            <input
              type="checkbox"
              checked={isPrimary}
              onChange={(e) => setIsPrimary(e.target.checked)}
            />
            本業として扱う
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
              {pending ? "保存中..." : "保存"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
