"use client";

import Link from "next/link";
import { useCallback, useState } from "react";

import { ACTION_TYPES, log } from "@/entities/action-log/logger";
import type { Event } from "@/entities/event/types";
import { projectOrder } from "@/entities/project/projects";
import type { Task } from "@/entities/task/types";
import { DayTimeline } from "@/features/day-timeline/DayTimeline";
import { EventDetailPanel } from "@/features/event-detail/EventDetailPanel";
import { TaskDetailPanel } from "@/features/task-detail/TaskDetailPanel";
import { TaskStack } from "@/features/task-stack/TaskStack";
import { TreeView } from "@/features/tree-view/TreeView";
import { UserMenu } from "@/features/user-menu/UserMenu";
import { initialEvents } from "@/mocks/events";
import { historyData } from "@/mocks/history";
import { initialTasks } from "@/mocks/tasks";
import { TODAY } from "@/mocks/today";

type View = "stack" | "tree";

type AppShellProps = {
  initialView: View;
  user: {
    email: string | null;
    avatarUrl: string | null;
  };
};

export function AppShell({ initialView, user }: AppShellProps) {
  const view = initialView;
  const [tasks, setTasks] = useState<Task[]>(initialTasks);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [eventDetailId, setEventDetailId] = useState<string | null>(null);

  const toggleDone = useCallback((id: string) => {
    setTasks((ts) => {
      const target = ts.find((t) => t.id === id);
      if (target && !target.done) {
        log(ACTION_TYPES.TASK_COMPLETED, { task_id: id });
      }
      return ts.map((t) => (t.id === id ? { ...t, done: !t.done } : t));
    });
  }, []);

  const updateBody = useCallback((id: string, body: string) => {
    setTasks((ts) => ts.map((t) => (t.id === id ? { ...t, body } : t)));
  }, []);

  const reorder = useCallback((fromIdx: number, toIdx: number) => {
    setTasks((ts) => {
      const pending = ts.filter((t) => !t.done);
      const done = ts.filter((t) => t.done);
      const next = [...pending];
      const [item] = next.splice(fromIdx, 1);
      next.splice(toIdx, 0, item);
      log(ACTION_TYPES.TASK_REORDERED, {
        task_id: item.id,
        from_position: fromIdx,
        to_position: toIdx,
      });
      return [...next, ...done];
    });
  }, []);

  const pendingTasks = tasks.filter((t) => !t.done);
  const doneTasks = tasks.filter((t) => t.done);
  const nowMin = 9 * 60 + 15;
  const detailTask = detailId ? tasks.find((t) => t.id === detailId) : null;

  const tabs: { key: View; label: string; href: string }[] = [
    { key: "stack", label: "Stack", href: "/" },
    { key: "tree", label: "Tree", href: "/tree" },
  ];

  return (
    <div className="relative select-none">
      {/* Header */}
      <div className="sticky top-0 z-50 flex items-center gap-3 border-b border-bg-elevated bg-bg-primary px-5 pb-3 pt-4">
        <div className="font-jp text-[16px] font-bold -tracking-[0.02em]">
          <span className="text-accent-blue">kozu</span>
          <span className="text-fg-faint">tsumi</span>
        </div>
        <div className="flex-1" />
        <div className="flex rounded-md bg-bg-elevated p-0.5">
          {tabs.map((tab) => {
            const active = view === tab.key;
            return (
              <Link
                key={tab.key}
                href={tab.href}
                className={`cursor-pointer rounded-[4px] px-3.5 py-1 text-[11px] font-medium no-underline ${
                  active
                    ? "bg-bg-divider text-fg-emphasized"
                    : "bg-transparent text-fg-weak"
                }`}
              >
                {tab.label}
              </Link>
            );
          })}
        </div>
        <UserMenu email={user.email} avatarUrl={user.avatarUrl} />
      </div>

      {view === "stack" ? (
        <StackView
          events={initialEvents}
          pendingTasks={pendingTasks}
          doneTasks={doneTasks}
          toggleDone={toggleDone}
          reorder={reorder}
          nowMin={nowMin}
          today={TODAY}
          onOpenDetail={setDetailId}
          onOpenEvent={setEventDetailId}
        />
      ) : (
        <TreeView historyData={historyData} projectOrder={projectOrder} />
      )}

      {/* Detail panel overlay */}
      {detailTask && (
        <TaskDetailPanel
          task={detailTask}
          events={initialEvents}
          onClose={() => setDetailId(null)}
          onUpdate={updateBody}
          onToggleDone={toggleDone}
        />
      )}

      {/* Event detail overlay */}
      {eventDetailId &&
        (() => {
          const ev = initialEvents.find((e) => e.id === eventDetailId);
          return ev ? (
            <EventDetailPanel
              event={ev}
              onClose={() => setEventDetailId(null)}
            />
          ) : null;
        })()}
    </div>
  );
}

type StackViewProps = {
  events: Event[];
  pendingTasks: Task[];
  doneTasks: Task[];
  toggleDone: (id: string) => void;
  reorder: (from: number, to: number) => void;
  nowMin: number;
  today: string;
  onOpenDetail: (id: string) => void;
  onOpenEvent: (id: string) => void;
};

function StackView({
  events,
  pendingTasks,
  doneTasks,
  toggleDone,
  reorder,
  nowMin,
  today,
  onOpenDetail,
  onOpenEvent,
}: StackViewProps) {
  return (
    <div className="pb-[100px]">
      <DayTimeline
        events={events}
        nowMin={nowMin}
        today={today}
        onOpenEvent={onOpenEvent}
      />
      <TaskStack
        events={events}
        pendingTasks={pendingTasks}
        doneTasks={doneTasks}
        onReorder={reorder}
        onToggleDone={toggleDone}
        onOpenDetail={onOpenDetail}
      />
    </div>
  );
}
