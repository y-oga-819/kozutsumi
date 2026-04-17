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
import { initialEvents } from "@/mocks/events";
import { historyData } from "@/mocks/history";
import { initialTasks } from "@/mocks/tasks";
import { TODAY } from "@/mocks/today";

type View = "stack" | "tree";

type AppShellProps = {
  initialView: View;
};

export function AppShell({ initialView }: AppShellProps) {
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
    <div
      style={{
        position: "relative",
        userSelect: "none",
        WebkitUserSelect: "none",
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: "16px 20px 12px",
          display: "flex",
          alignItems: "center",
          gap: 12,
          borderBottom: "1px solid #18181b",
          position: "sticky",
          top: 0,
          background: "#0a0a0b",
          zIndex: 50,
        }}
      >
        <div
          style={{
            fontFamily: "'Noto Sans JP', sans-serif",
            fontWeight: 700,
            fontSize: 16,
            letterSpacing: "-0.02em",
          }}
        >
          <span style={{ color: "#58A6FF" }}>kozu</span>
          <span style={{ color: "#3f3f46" }}>tsumi</span>
        </div>
        <div style={{ flex: 1 }} />
        <div
          style={{
            display: "flex",
            background: "#18181b",
            borderRadius: 6,
            padding: 2,
          }}
        >
          {tabs.map((tab) => {
            const active = view === tab.key;
            return (
              <Link
                key={tab.key}
                href={tab.href}
                style={{
                  fontSize: 11,
                  fontFamily: "'IBM Plex Mono', monospace",
                  padding: "4px 14px",
                  borderRadius: 4,
                  cursor: "pointer",
                  background: active ? "#27272a" : "transparent",
                  color: active ? "#e4e4e7" : "#52525b",
                  fontWeight: 500,
                  textDecoration: "none",
                }}
              >
                {tab.label}
              </Link>
            );
          })}
        </div>
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
    <div style={{ padding: "0 0 100px" }}>
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
