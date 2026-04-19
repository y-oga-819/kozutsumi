import type { Project } from "./types";

/**
 * シード用のプロジェクト初期定義。
 * 初回ログイン時 or 「サンプルを再投入」ボタンからこれらを Supabase に挿入する。
 * slug (key) はサンプルタスク/イベントの projectId 参照に使うためのローカル識別子。
 */
export type ProjectSeed = {
  slug: string;
  name: string;
  color: string;
  isPrimary: boolean;
};

export const PROJECT_SEEDS: readonly ProjectSeed[] = [
  { slug: "career", name: "転職活動", color: "#E85D04", isPrimary: false },
  { slug: "loadtest", name: "負荷試験", color: "#0096C7", isPrimary: false },
  { slug: "slo", name: "SLO推進", color: "#2D9F45", isPrimary: true },
  { slug: "tasuki", name: "Tasuki", color: "#9B5DE5", isPrimary: false },
];

/**
 * Project 配列から id → Project のマップを作る。
 */
export function indexProjectsById(
  projects: readonly Project[],
): Record<string, Project> {
  const out: Record<string, Project> = {};
  for (const p of projects) out[p.id] = p;
  return out;
}

/**
 * 未知の projectId を参照された時の安全な fallback。
 * DB 削除と UI キャッシュがズレた瞬間に落ちないための保険。
 */
export const FALLBACK_PROJECT: Project = {
  id: "__fallback__",
  name: "—",
  color: "#52525b",
  isPrimary: false,
  createdAt: "",
};

export function getProject(
  projectsById: Record<string, Project>,
  projectId: string | null | undefined,
): Project {
  if (!projectId) return FALLBACK_PROJECT;
  return projectsById[projectId] ?? FALLBACK_PROJECT;
}
