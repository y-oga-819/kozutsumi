/**
 * ADR 0016 プロトタイプ用のサンプルデータ。
 *
 * 本物の Task 型 (src/entities/task/types.ts) は parentTaskId / status /
 * stackOrder を持つが、ここでは「Stack View に何をどう積むか」だけを比較したい
 * ので、親と子を入れ子構造で持つ独自型に整理する。
 *
 * decomposeStatus は「親が AI 分解にどの段階で接しているか」を示すローカル概念:
 * - "decomposed"   : 子が返ってきている。親はデータ上残り、Stack 表現は variant 次第
 * - "decomposing"  : AI 呼び出し中 (非同期、ADR 0013 の augmentation 原則)
 * - "skipped"      : AI が「分解不要」と判断
 * - "none"         : まだ AI に投げていない (e2e の AI_ENABLED=false 等)
 */

export type DecomposeStatus = "decomposed" | "decomposing" | "skipped" | "none";

export type SampleProject = {
  id: string;
  name: string;
  color: string;
};

export type SampleChild = {
  id: string;
  title: string;
  estimatedMinutes: number;
};

export type SampleParent = {
  id: string;
  projectId: string;
  title: string;
  estimatedMinutes: number;
  decomposeStatus: DecomposeStatus;
  /** 依存イベントのヒント (Stack View の amber バッジを再現するためのみ) */
  depEvent?: { title: string; relative: string; imminent?: boolean };
  children: SampleChild[];
};

export const SAMPLE_PROJECTS: Record<string, SampleProject> = {
  career: { id: "career", name: "転職活動", color: "#E85D04" },
  loadtest: { id: "loadtest", name: "負荷試験", color: "#0096C7" },
  slo: { id: "slo", name: "SLO推進", color: "#2D9F45" },
  tasuki: { id: "tasuki", name: "Tasuki", color: "#9B5DE5" },
};

export const SAMPLE_PARENTS: SampleParent[] = [
  {
    id: "p1",
    projectId: "career",
    title: "面接対策：志望動機の最終整理",
    estimatedMinutes: 45,
    decomposeStatus: "decomposed",
    depEvent: { title: "Dirbato 最終面接", relative: "明日 14:00", imminent: true },
    children: [
      { id: "p1c1", title: "志望動機パターンA作成", estimatedMinutes: 15 },
      { id: "p1c2", title: "志望動機パターンB作成", estimatedMinutes: 15 },
      { id: "p1c3", title: "逆質問リスト整理", estimatedMinutes: 15 },
    ],
  },
  {
    id: "p2",
    projectId: "slo",
    title: "SLI定義ドキュメント更新",
    estimatedMinutes: 40,
    decomposeStatus: "decomposing",
    depEvent: { title: "SRE 定例", relative: "金 11:00" },
    children: [],
  },
  {
    id: "p3",
    projectId: "loadtest",
    title: "WireMock stub定義作成",
    estimatedMinutes: 35,
    decomposeStatus: "decomposed",
    children: [
      { id: "p3c1", title: "正常系 stub", estimatedMinutes: 10 },
      { id: "p3c2", title: "429 stub", estimatedMinutes: 10 },
      { id: "p3c3", title: "500ms 遅延 stub", estimatedMinutes: 15 },
    ],
  },
  {
    id: "p4",
    projectId: "career",
    title: "職務経歴書PDF最終版を送付",
    estimatedMinutes: 15,
    decomposeStatus: "skipped",
    children: [],
  },
  {
    id: "p5",
    projectId: "tasuki",
    title: "AnalyzerContract trait設計",
    estimatedMinutes: 90,
    decomposeStatus: "decomposed",
    children: [
      { id: "p5c1", title: "既存実装の調査メモ", estimatedMinutes: 20 },
      { id: "p5c2", title: "trait シグネチャ草案", estimatedMinutes: 30 },
      { id: "p5c3", title: "Rust 実装ドラフト", estimatedMinutes: 40 },
    ],
  },
  {
    id: "p6",
    projectId: "loadtest",
    title: "Locustシナリオ実装",
    estimatedMinutes: 120,
    decomposeStatus: "none",
    children: [],
  },
];

export function fmtMinutes(m: number): string {
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return rem === 0 ? `${h}h` : `${h}h${String(rem).padStart(2, "0")}m`;
}
