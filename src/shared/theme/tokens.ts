import { PROJECTS } from "../../entities/project/projects";
import type { ProjectKey } from "../../entities/project/types";

export const BG_COLORS = {
  primary: "#0a0a0b",
  surface: "#111113",
  elevated: "#18181b",
  muted: "#141416",
  hover: "#1a1a1d",
  current: "#1a2e1a",
  past: "#131316",
  slot: "#131316",
  border: "#1c1c1e",
  divider: "#27272a",
} as const;

export const FG_COLORS = {
  strong: "#fafafa",
  emphasized: "#e4e4e7",
  default: "#d4d4d8",
  muted: "#a1a1aa",
  subtle: "#71717a",
  weak: "#52525b",
  faint: "#3f3f46",
  done: "#8B949E",
  invert: "#ffffff",
} as const;

export const ACCENT_COLORS = {
  blue: "#58A6FF",
  green: "#22c55e",
  amber: "#E85D04",
  red: "#ef4444",
  zoomFg: "#5B9EFF",
  zoomBg: "#2D8CFF",
  meetFg: "#34D399",
  meetBg: "#00AC47",
} as const;

export const PROJECT_COLORS: Record<ProjectKey, string> = Object.fromEntries(
  Object.entries(PROJECTS).map(([key, value]) => [key, value.color]),
) as Record<ProjectKey, string>;
