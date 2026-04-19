import { PROJECT_SEEDS } from "../../entities/project/projects";

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

/**
 * Tailwind の color palette 用。
 * ユーザーが追加したプロジェクトは対象外 (動的 class 生成は Tailwind と相性が悪いため)。
 * 既定シード 4 色のみ Tailwind 経由で参照可能にする。
 */
export const PROJECT_COLORS: Record<string, string> = Object.fromEntries(
  PROJECT_SEEDS.map((seed) => [seed.slug, seed.color]),
);
