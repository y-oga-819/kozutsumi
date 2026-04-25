"use client";

import { useState } from "react";

import type { CreateProjectInput } from "@/entities/project/gateway";

type ProjectFormProps = {
  onSubmit: (input: CreateProjectInput) => Promise<void>;
  onClose: () => void;
};

const DEFAULT_COLORS = ["#E85D04", "#0096C7", "#2D9F45", "#9B5DE5", "#58A6FF", "#EF4444"];

/**
 * Phase 1 仕様 Step 3「プロジェクト管理（名前、色、本業フラグ）」。
 */
export function ProjectForm({ onSubmit, onClose }: ProjectFormProps) {
  const [name, setName] = useState("");
  const [color, setColor] = useState<string>(DEFAULT_COLORS[0]);
  const [isPrimary, setIsPrimary] = useState(false);
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
      await onSubmit({ name: name.trim(), color, isPrimary });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存に失敗しました");
      setPending(false);
    }
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <label className="flex flex-col gap-1">
        <span className="font-jp text-[10px] text-fg-weak">名前</span>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
          className="rounded border border-bg-divider bg-bg-elevated px-3 py-2 text-[13px] text-fg-default outline-none focus:border-accent-blue"
          placeholder="例: 転職活動"
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
