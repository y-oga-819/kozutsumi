"use client";

import { useState } from "react";

import type { CreateEventInput } from "@/entities/event/gateway";
import type { Event } from "@/entities/event/types";
import type { CreateProjectInput } from "@/entities/project/gateway";
import type { Project } from "@/entities/project/types";
import type { CreateTaskInput } from "@/entities/task/gateway";

import { EventForm } from "./EventForm";
import { ProjectForm } from "./ProjectForm";
import { TaskForm } from "./TaskForm";

type Tab = "task" | "event" | "project";

type AddPanelProps = {
  projects: readonly Project[];
  events: readonly Event[];
  initialTab?: Tab;
  onClose: () => void;
  onCreateTask: (input: CreateTaskInput) => Promise<void>;
  onCreateEvent: (input: CreateEventInput) => Promise<void>;
  onCreateProject: (input: CreateProjectInput) => Promise<void>;
  /**
   * 既存プロジェクト行クリック時のハンドラ。Issue #75 で編集 / 削除導線として追加。
   * 未指定なら一覧は read-only 表示として描画する (テスト等での省略可)。
   */
  onOpenProject?: (id: string) => void;
};

/**
 * タスク / イベント / プロジェクト追加フォームを切り替える共通ボトムシート。
 */
export function AddPanel({
  projects,
  events,
  initialTab = "task",
  onClose,
  onCreateTask,
  onCreateEvent,
  onCreateProject,
  onOpenProject,
}: AddPanelProps) {
  const [tab, setTab] = useState<Tab>(initialTab);

  const tabs: { key: Tab; label: string }[] = [
    { key: "task", label: "タスク" },
    { key: "event", label: "イベント" },
    { key: "project", label: "プロジェクト" },
  ];

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="追加メニュー"
      className="fixed inset-0 z-[210] flex flex-col"
    >
      <div onClick={onClose} className="absolute inset-0 bg-black/60 backdrop-blur-[4px]" />
      <div className="relative mt-auto flex max-h-[85vh] animate-panel-slide-up flex-col rounded-t-2xl bg-bg-surface">
        <div className="flex justify-center pb-1 pt-2.5">
          <div className="h-[3px] w-8 rounded-[2px] bg-bg-divider" />
        </div>

        <div role="tablist" aria-label="追加メニュー" className="flex gap-1 px-4 pt-1">
          {tabs.map((t) => {
            const active = tab === t.key;
            return (
              <button
                type="button"
                role="tab"
                aria-selected={active}
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`rounded-t-md px-3 py-1.5 font-jp text-[11px] font-medium ${
                  active ? "bg-bg-elevated text-fg-emphasized" : "bg-transparent text-fg-weak"
                }`}
              >
                {t.label}
              </button>
            );
          })}
        </div>

        <div className="mx-4 h-px bg-bg-border" />

        <div className="flex-1 overflow-auto px-5 pb-6 pt-4">
          {tab === "task" ? (
            // #170 / ADR 0039: project は任意化された。projects.length === 0 でも
            // タスクは未指定 (Inbox 的) で登録できる。
            <TaskForm
              projects={projects}
              events={events}
              onSubmit={onCreateTask}
              onClose={onClose}
            />
          ) : null}
          {tab === "event" ? (
            <EventForm projects={projects} onSubmit={onCreateEvent} onClose={onClose} />
          ) : null}
          {tab === "project" ? (
            <div className="flex flex-col gap-4">
              {projects.length > 0 ? (
                <ProjectList projects={projects} onOpen={onOpenProject} />
              ) : null}
              <div className="flex flex-col gap-2">
                {projects.length > 0 ? (
                  <span className="font-jp text-[10px] text-fg-weak">新しいプロジェクト</span>
                ) : null}
                <ProjectForm onSubmit={onCreateProject} onClose={onClose} />
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function ProjectList({
  projects,
  onOpen,
}: {
  projects: readonly Project[];
  onOpen: ((id: string) => void) | undefined;
}) {
  return (
    <div className="flex flex-col gap-2">
      <span className="font-jp text-[10px] text-fg-weak">既存プロジェクト</span>
      <ul className="flex flex-col gap-1">
        {projects.map((p) => (
          <li key={p.id}>
            <button
              type="button"
              onClick={() => onOpen?.(p.id)}
              disabled={!onOpen}
              aria-label={`${p.name} を編集`}
              className="flex w-full items-center gap-2 rounded border border-bg-divider bg-bg-elevated px-3 py-2 text-left transition-colors hover:bg-bg-divider disabled:cursor-default disabled:hover:bg-bg-elevated"
            >
              <span className="h-2 w-2 rounded-full" style={{ background: p.color }} />
              <span className="flex-1 font-jp text-[12px] text-fg-default">{p.name}</span>
              {p.isPrimary ? (
                <span className="rounded bg-bg-divider px-1.5 py-px font-jp text-[9px] text-fg-muted">
                  本業
                </span>
              ) : null}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
