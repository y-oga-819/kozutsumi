import type { EventSlot as EventSlotType, Slot } from "./buildSlots";
import { getProject } from "../../entities/project/projects";
import { useProjects } from "../../entities/project/ProjectsContext";
import { fmtDuration } from "../../shared/lib/time";

function computeTimeLabels(dayStart: number, dayEnd: number): number[] {
  const startH = dayStart / 60;
  const endH = dayEnd / 60;
  const span = endH - startH;
  const step = span <= 6 ? 1 : span <= 12 ? 3 : 4;
  const labels: number[] = [];
  for (let h = startH; h <= endH; h += step) labels.push(h);
  if (labels[labels.length - 1] !== endH) labels.push(endH);
  return labels;
}

type SlotDisplayProps = {
  widthPct: number;
  isPast: boolean;
  isCurrent: boolean;
  nowPct: number;
  label: string;
};

function EventSlot({
  slot,
  widthPct,
  isPast,
  isCurrent,
  nowPct,
  label,
}: SlotDisplayProps & { slot: EventSlotType }) {
  const { projectsById } = useProjects();
  const evColor = slot.event.projectId
    ? getProject(projectsById, slot.event.projectId).color
    : "#52525b";
  return (
    <div
      className="relative flex min-w-[3px] items-center justify-center overflow-hidden"
      style={{
        width: `${widthPct}%`,
        background: isPast ? `${evColor}25` : `${evColor}50`,
      }}
    >
      {isCurrent && (
        <div
          className="absolute bottom-0 top-0 z-[2] w-0.5 bg-accent-green"
          style={{ left: `${nowPct}%` }}
        />
      )}
      {widthPct > 4 && (
        <span
          className={`whitespace-nowrap text-[7px] tabular-nums opacity-80 ${
            isPast ? "text-fg-weak" : "text-fg-emphasized"
          }`}
        >
          {label}
        </span>
      )}
    </div>
  );
}

function FreeSlot({ widthPct, isPast, isCurrent, nowPct, label }: SlotDisplayProps) {
  return (
    <div
      className={`relative flex min-w-[3px] items-center justify-center overflow-hidden ${
        isPast
          ? "bg-bg-past"
          : isCurrent
            ? "rounded-[3px] border border-[#22c55e30] bg-bg-current"
            : "bg-bg-slot"
      }`}
      style={{ width: `${widthPct}%` }}
    >
      {isCurrent && (
        <div
          className="absolute bottom-0 top-0 z-[2] w-0.5 bg-accent-green"
          style={{ left: `${nowPct}%` }}
        />
      )}
      {widthPct > 4 && (
        <span
          className={`whitespace-nowrap text-[7px] tabular-nums ${
            isPast ? "text-bg-divider" : isCurrent ? "text-accent-green" : "text-fg-faint"
          }`}
        >
          {label}
        </span>
      )}
    </div>
  );
}

type TimelineBarProps = {
  slots: Slot[];
  nowMin: number;
  dayStart: number;
  dayEnd: number;
};

export function TimelineBar({ slots, nowMin, dayStart, dayEnd }: TimelineBarProps) {
  return (
    <>
      <div className="flex h-7 gap-0.5 overflow-hidden rounded-[5px] bg-bg-elevated">
        {slots.map((slot, i) => {
          const widthPct = (slot.duration / (dayEnd - dayStart)) * 100;
          const isPast = slot.end <= nowMin;
          const isCurrent = slot.start <= nowMin && slot.end > nowMin;
          const nowPct = isCurrent ? ((nowMin - slot.start) / slot.duration) * 100 : 0;
          const label = fmtDuration(slot.duration);
          const props = { widthPct, isPast, isCurrent, nowPct, label };
          return slot.type === "event" ? (
            <EventSlot key={i} slot={slot} {...props} />
          ) : (
            <FreeSlot key={i} {...props} />
          );
        })}
      </div>

      <div className="flex justify-between px-0.5 pt-[3px]">
        {computeTimeLabels(dayStart, dayEnd).map((h) => (
          <span key={h} className="text-[8px] tabular-nums text-fg-faint">
            {h}:00
          </span>
        ))}
      </div>
    </>
  );
}
