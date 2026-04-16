import type { EventSlot as EventSlotType, Slot } from "./buildSlots";
import { PROJECTS } from "../../entities/project/projects";
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

function EventSlot({ slot, widthPct, isPast, isCurrent, nowPct, label }: SlotDisplayProps & { slot: EventSlotType }) {
  const evColor = slot.event.project
    ? PROJECTS[slot.event.project].color
    : "#52525b";
  return (
    <div
      style={{
        width: `${widthPct}%`,
        minWidth: 3,
        background: isPast ? `${evColor}25` : `${evColor}50`,
        position: "relative",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
      }}
    >
      {isCurrent && (
        <div
          style={{
            position: "absolute",
            left: `${nowPct}%`,
            top: 0,
            bottom: 0,
            width: 2,
            background: "#22c55e",
            zIndex: 2,
          }}
        />
      )}
      {widthPct > 4 && (
        <span
          style={{
            fontSize: 7,
            color: isPast ? "#52525b" : "#e4e4e7",
            fontVariantNumeric: "tabular-nums",
            whiteSpace: "nowrap",
            opacity: 0.8,
          }}
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
      style={{
        width: `${widthPct}%`,
        minWidth: 3,
        background: isPast ? "#111113" : isCurrent ? "#1a2e1a" : "#131316",
        position: "relative",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
        border: isCurrent ? "1px solid #22c55e30" : "none",
        borderRadius: isCurrent ? 3 : 0,
      }}
    >
      {isCurrent && (
        <div
          style={{
            position: "absolute",
            left: `${nowPct}%`,
            top: 0,
            bottom: 0,
            width: 2,
            background: "#22c55e",
            zIndex: 2,
          }}
        />
      )}
      {widthPct > 4 && (
        <span
          style={{
            fontSize: 7,
            color: isPast ? "#27272a" : isCurrent ? "#22c55e" : "#3f3f46",
            fontVariantNumeric: "tabular-nums",
            whiteSpace: "nowrap",
          }}
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
      <div
        style={{
          display: "flex",
          gap: 2,
          height: 28,
          borderRadius: 5,
          overflow: "hidden",
          background: "#18181b",
        }}
      >
        {slots.map((slot, i) => {
          const widthPct = (slot.duration / (dayEnd - dayStart)) * 100;
          const isPast = slot.end <= nowMin;
          const isCurrent = slot.start <= nowMin && slot.end > nowMin;
          const nowPct = isCurrent
            ? ((nowMin - slot.start) / slot.duration) * 100
            : 0;
          const label = fmtDuration(slot.duration);
          const props = { widthPct, isPast, isCurrent, nowPct, label };
          return slot.type === "event" ? (
            <EventSlot key={i} slot={slot} {...props} />
          ) : (
            <FreeSlot key={i} {...props} />
          );
        })}
      </div>

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          padding: "3px 2px 0",
        }}
      >
        {computeTimeLabels(dayStart, dayEnd).map((h) => (
          <span
            key={h}
            style={{
              fontSize: 8,
              color: "#3f3f46",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {h}:00
          </span>
        ))}
      </div>
    </>
  );
}
