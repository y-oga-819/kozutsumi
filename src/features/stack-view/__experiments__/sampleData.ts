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
  /** body preview (markdown 1 行目相当の短い説明) */
  body?: string;
};

export type SampleParent = {
  id: string;
  projectId: string;
  title: string;
  estimatedMinutes: number;
  decomposeStatus: DecomposeStatus;
  /** 依存イベントのヒント (Stack View の amber バッジを再現するためのみ) */
  depEvent?: { title: string; relative: string; imminent?: boolean };
  /** body preview (子が無い親が Top に来る時用) */
  body?: string;
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
    // 子に固有順序は無い。Stack 出現順 (= ここの配列順) で
    // ParallelogramProgress の「現在=自分のセグメント」が決まる。
    // ここでは「A → 逆質問 → B」の順にして、逆質問が真ん中、B が右端で
    // 光るデモにする (元は A → B → 逆質問)。
    children: [
      {
        id: "p1c1",
        title: "志望動機パターンA作成",
        estimatedMinutes: 15,
        body: "DDD / Clean Architecture の経験を 3 つの軸で整理する",
      },
      {
        id: "p1c3",
        title: "逆質問リスト整理",
        estimatedMinutes: 15,
        body: "上流工程・チーム運営・スキル開発の 3 軸で 3 つずつ用意",
      },
      {
        id: "p1c2",
        title: "志望動機パターンB作成",
        estimatedMinutes: 15,
        body: "前職での具体例を交えて、技術以外の意欲も伝える",
      },
    ],
  },
  {
    id: "p2",
    projectId: "slo",
    title: "SLI定義ドキュメント更新",
    estimatedMinutes: 40,
    decomposeStatus: "decomposing",
    depEvent: { title: "SRE 定例", relative: "金 11:00" },
    body: "Web Cart の availability / latency を New Relic のメトリクスに揃える",
    children: [],
  },
  {
    id: "p3",
    projectId: "loadtest",
    title: "WireMock stub定義作成",
    estimatedMinutes: 35,
    decomposeStatus: "decomposed",
    children: [
      { id: "p3c1", title: "正常系 stub", estimatedMinutes: 10, body: "/api/v1/orders 200 を返す" },
      { id: "p3c2", title: "429 stub", estimatedMinutes: 10, body: "rate limit 越えのレスポンス" },
      {
        id: "p3c3",
        title: "500ms 遅延 stub",
        estimatedMinutes: 15,
        body: "/api/v1/payments の遅延シミュレート",
      },
    ],
  },
  {
    id: "p4",
    projectId: "career",
    title: "職務経歴書PDF最終版を送付",
    estimatedMinutes: 15,
    decomposeStatus: "skipped",
    body: "最終版PDFを浅野さんにメール送付。誤字脱字 / 在籍期間 確認済",
    children: [],
  },
  {
    id: "p5",
    projectId: "tasuki",
    title: "AnalyzerContract trait設計",
    estimatedMinutes: 90,
    decomposeStatus: "decomposed",
    children: [
      {
        id: "p5c1",
        title: "既存実装の調査メモ",
        estimatedMinutes: 20,
        body: "code-inspector の既存抽象化レイヤを読み解く",
      },
      {
        id: "p5c2",
        title: "trait シグネチャ草案",
        estimatedMinutes: 30,
        body: "AnalyzerContract に必要なメソッドを 3 つ列挙",
      },
      {
        id: "p5c3",
        title: "Rust 実装ドラフト",
        estimatedMinutes: 40,
        body: "php-parser / tree-sitter の両対応を意識した skeleton",
      },
    ],
  },
  {
    id: "p6",
    projectId: "loadtest",
    title: "Locustシナリオ実装",
    estimatedMinutes: 120,
    decomposeStatus: "none",
    body: "ピーク負荷パターン (500 RPS / 10 分) を分散モードで",
    children: [],
  },
  // 4 子で 3 完了のシナリオ (進行中の親)。
  // Variant E の初期 done set で p8c1 / p8c2 / p8c3 を done にしている。
  {
    id: "p8",
    projectId: "tasuki",
    title: "PR レビュー: AnalyzerContract trait",
    estimatedMinutes: 60,
    decomposeStatus: "decomposed",
    children: [
      { id: "p8c1", title: "コメント拾い読み", estimatedMinutes: 10 },
      { id: "p8c2", title: "テスト追加要件まとめ", estimatedMinutes: 15 },
      { id: "p8c3", title: "リプライ作成", estimatedMinutes: 15 },
      { id: "p8c4", title: "再 push 後の CI 確認", estimatedMinutes: 20 },
    ],
  },
  // 10 子のシナリオ (大きく分解された親)。
  // Variant E の初期 done set で 4 個 done (4/10 完了)。
  {
    id: "p7",
    projectId: "loadtest",
    title: "Locust 詳細実装 (10 ステップ)",
    estimatedMinutes: 200,
    decomposeStatus: "decomposed",
    children: [
      { id: "p7c1", title: "ピーク負荷シナリオ定義", estimatedMinutes: 20 },
      { id: "p7c2", title: "ramp-up curve 設定", estimatedMinutes: 15 },
      { id: "p7c3", title: "ECS タスク数の試算", estimatedMinutes: 20 },
      { id: "p7c4", title: "stub サーバ立ち上げ", estimatedMinutes: 15 },
      { id: "p7c5", title: "正常系 / 429 / 500ms ミックス定義", estimatedMinutes: 25 },
      { id: "p7c6", title: "メトリクス閾値設定", estimatedMinutes: 20 },
      { id: "p7c7", title: "ローカルで dry-run", estimatedMinutes: 20 },
      { id: "p7c8", title: "GitHub Actions ワークフロー", estimatedMinutes: 20 },
      { id: "p7c9", title: "実環境向けパラメータ調整", estimatedMinutes: 25 },
      { id: "p7c10", title: "結果レポート整形", estimatedMinutes: 20 },
    ],
  },
];

/**
 * Variant E の初期 done set。「3/4 完了」「4/10 完了」のシナリオを
 * 開いた瞬間に確認できるようにする (プロトタイプ用)。
 * 他の variant では使わない (`useDoneSet()` は引数なしで呼ばれる)。
 */
export const SAMPLE_INITIAL_DONE: readonly string[] = [
  // p8: 4 子のうち 3 完了 (4 番目だけ未完了)
  "p8c1",
  "p8c2",
  "p8c3",
  // p7: 10 子のうち 4 完了 (どれが done かはバラバラに)
  "p7c1",
  "p7c2",
  "p7c4",
  "p7c6",
];

export function fmtMinutes(m: number): string {
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return rem === 0 ? `${h}h` : `${h}h${String(rem).padStart(2, "0")}m`;
}
