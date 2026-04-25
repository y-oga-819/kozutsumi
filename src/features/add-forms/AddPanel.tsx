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
            projects.length === 0 ? (
              <EmptyProjectsNotice onSwitch={() => setTab("project")} />
            ) : (
              <TaskForm
                projects={projects}
                events={events}
                onSubmit={onCreateTask}
                onClose={onClose}
              />
            )
          ) : null}
          {tab === "event" ? (
            <EventForm projects={projects} onSubmit={onCreateEvent} onClose={onClose} />
          ) : null}
          {tab === "project" ? <ProjectForm onSubmit={onCreateProject} onClose={onClose} /> : null}
        </div>
      </div>
    </div>
  );
}

function EmptyProjectsNotice({ onSwitch }: { onSwitch: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 py-6 text-center">
      <p className="font-jp text-[12px] text-fg-muted">タスクにはプロジェクトが必要です。</p>
      <button
        type="button"
        onClick={onSwitch}
        className="rounded bg-accent-blue px-4 py-1.5 font-jp text-[11px] font-semibold text-fg-invert"
      >
        プロジェクトを先に作る
      </button>
    </div>
  );
}
