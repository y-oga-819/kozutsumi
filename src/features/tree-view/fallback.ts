import type { Project } from "@/entities/project/types";

/**
 * Tree View の mock history が参照する旧 slug (`career` 等) の名称・色を、
 * DB に該当 Project が無い場合の fallback として埋めるためのマップ。
 * PROJECT_SEEDS を import すると循環が見えにくくなるので、ここで簡易定義する。
 * history (mock) に現れる slug 群だけ埋めれば十分。
 */
const TREE_FALLBACK_BY_SLUG: ReadonlyMap<string, Project> = new Map([
  ["career", { id: "career", name: "転職活動", color: "#E85D04", isPrimary: false, createdAt: "" }],
  [
    "loadtest",
    { id: "loadtest", name: "負荷試験", color: "#0096C7", isPrimary: false, createdAt: "" },
  ],
  ["slo", { id: "slo", name: "SLO推進", color: "#2D9F45", isPrimary: true, createdAt: "" }],
  ["tasuki", { id: "tasuki", name: "Tasuki", color: "#9B5DE5", isPrimary: false, createdAt: "" }],
]);

/**
 * Tree View の mock history が参照する旧 slug を、
 * 同名シードが DB にある場合はその Project として、無い場合は fallback として補完する。
 * ProjectsProvider に渡す projects 配列を生成するための helper。
 */
export function mergeTreeProjects(
  projects: readonly Project[],
  history: readonly { projectId: string }[],
): Project[] {
  const known = new Set(projects.map((p) => p.id));
  const missing = Array.from(
    new Set(history.map((h) => h.projectId).filter((id) => !known.has(id))),
  );
  const result = [...projects];
  for (const slug of missing) {
    const seed = TREE_FALLBACK_BY_SLUG.get(slug);
    result.push(
      seed ?? {
        id: slug,
        name: slug,
        color: "#52525b",
        isPrimary: false,
        createdAt: "",
      },
    );
  }
  return result;
}

/**
 * Tree View に渡す projectOrder を返す。
 * - DB にプロジェクトがあればその id 順
 * - 無ければ mock history の projectId 順 (= 旧 PoC の挙動)
 */
export function computeProjectOrderForTree(
  projects: readonly Project[],
  history: readonly { projectId: string }[],
): string[] {
  if (projects.length === 0) {
    return Array.from(new Set(history.map((h) => h.projectId)));
  }
  return projects.map((p) => p.id);
}
