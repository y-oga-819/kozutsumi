import type { Task } from "@/entities/task/types";

/**
 * サンプルタスク生成器。
 * createdAt/completedAt を呼び出し時点で確定させるため関数として提供する。
 */
export function buildInitialTasks(): Task[] {
  const now = new Date().toISOString();
  const base = {
    body: "",
    status: "idle" as const,
    isInterruption: false,
    parentTaskId: null,
    decomposeStatus: "none" as const,
    taskCategory: null,
    createdAt: now,
    completedAt: null,
  };

  return [
    {
      ...base,
      id: "t1",
      projectId: "career",
      title: "面接対策：志望動機の最終整理",
      estimatedMinutes: 45,
      stackOrder: 0,
      dependsOnEventId: "e3",
      body: "## やること\n\n- **志望動機**を3パターン用意\n- 技術的な強みの整理\n  - DDD / Clean Architecture\n  - SLI/SLO導入経験\n- 逆質問リストの準備\n\n## 参考\n\n`転職ドラフト`のフィードバックを確認\n\n> 上流工程への関与意欲が伝わる内容にすること",
    },
    {
      ...base,
      id: "t2",
      projectId: "slo",
      title: "SLI定義ドキュメント更新",
      estimatedMinutes: 40,
      stackOrder: 1,
      dependsOnEventId: "e2",
      body: "## 対象\n\nWeb Cart フロントエンドの SLI\n\n## 更新内容\n\n- Availability SLI: `成功リクエスト / 全リクエスト`\n- Latency SLI: `p99 < 500ms`\n- 計測ポイントをNew Relicの`Transaction`に合わせる",
    },
    {
      ...base,
      id: "t3",
      projectId: "loadtest",
      title: "WireMock stub定義作成",
      estimatedMinutes: 35,
      stackOrder: 2,
      dependsOnEventId: null,
      body: "chaos test用のstub定義ファイルを作成する\n\n### エンドポイント\n\n1. `/api/v1/orders` — 正常レスポンス\n2. `/api/v1/orders` — 429 レスポンス (rate limit)\n3. `/api/v1/payments` — 500ms遅延",
    },
    {
      ...base,
      id: "t4",
      projectId: "career",
      title: "職務経歴書PDF最終版を送付",
      estimatedMinutes: 15,
      stackOrder: 3,
      dependsOnEventId: null,
      body: "最終版PDFを浅野さんにメール送付\n\n確認ポイント:\n- 誤字脱字チェック済み\n- BASE在籍期間の記載が正確か",
    },
    {
      ...base,
      id: "t5",
      projectId: "tasuki",
      title: "AnalyzerContract trait設計",
      estimatedMinutes: 90,
      stackOrder: 4,
      dependsOnEventId: null,
      body: "## 目的\n\ncode-inspector用の抽象化層を設計する\n\n## 設計メモ\n\n```rust\ntrait AnalyzerContract {\n    fn analyze(&self, input: &SourceFile) -> AnalysisResult;\n    fn supports(&self, file_type: &FileType) -> bool;\n}\n```\n\n- php-parser と tree-sitter の両方に対応\n- call chain 解析は別traitに分離",
    },
    {
      ...base,
      id: "t6",
      projectId: "loadtest",
      title: "Locustシナリオ実装",
      estimatedMinutes: 120,
      stackOrder: 5,
      dependsOnEventId: null,
      body: "ピーク負荷パターンのシナリオを実装\n\n## 要件\n\n- 通常: 100 RPS\n- ピーク: 500 RPS (10分間)\n- ramp-up: 5分\n\n## メモ\n\n分散モードで ECS 上に展開予定",
    },
  ];
}
