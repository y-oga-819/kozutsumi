import type { SupabaseClient } from "@supabase/supabase-js";

import { createEvent } from "@/entities/event/api";
import { PROJECT_SEEDS } from "@/entities/project/projects";
import { createProject } from "@/entities/project/api";
import { createTask, updateTask } from "@/entities/task/api";
import type { Database } from "@/shared/types/database";
import { todayIso } from "@/shared/lib/time";

type Sb = SupabaseClient<Database>;

/**
 * サンプルデータを Supabase に一括投入する。
 *
 * 1. projects を先に insert して (slug -> projects.id) のマップを作る
 * 2. events を insert (slug -> events.id のマップを作る)
 * 3. tasks を insert。depends_on_event_id はイベント slug を置き換えて渡す
 *
 * 冪等性は呼び出し元 (reset/seed 判定) で担保する。
 */
export async function seedSampleDataToSupabase(supabase: Sb): Promise<void> {
  // 1. projects
  const projectSlugToId = new Map<string, string>();
  for (const seed of PROJECT_SEEDS) {
    const p = await createProject(supabase, {
      name: seed.name,
      color: seed.color,
      isPrimary: seed.isPrimary,
    });
    projectSlugToId.set(seed.slug, p.id);
  }

  // 2. events (サンプルは今日を基準に生成)
  const today = todayIso();
  const at = (hhmm: string) => `${today}T${hhmm}:00`;
  const eventSeeds: {
    slug: string;
    title: string;
    startTime: string;
    endTime: string;
    projectSlug: string | null;
    meetUrl: string | null;
    hasAttachments: boolean;
    description: string;
  }[] = [
    {
      slug: "e2",
      title: "SLOレビューMTG",
      startTime: at("09:30"),
      endTime: at("10:30"),
      projectSlug: "slo",
      meetUrl: "https://meet.google.com/abc-defg-hij",
      hasAttachments: true,
      description:
        "## アジェンダ\n\n1. SLI定義の最終確認\n2. エラーバジェットポリシーのレビュー\n3. New Relicダッシュボードのデモ\n\n## 参加者\n\n- 田中PM\n- インフラチーム\n- 自分",
    },
    {
      slug: "e1",
      title: "デイリースタンドアップ",
      startTime: at("11:00"),
      endTime: at("11:15"),
      projectSlug: null,
      meetUrl: null,
      hasAttachments: false,
      description: "チーム全体の進捗共有\n- 各自の今日のタスク確認\n- ブロッカーの共有",
    },
    {
      slug: "e3",
      title: "Dirbato最終面接",
      startTime: at("14:00"),
      endTime: at("15:00"),
      projectSlug: "career",
      meetUrl: "https://zoom.us/j/123456789",
      hasAttachments: true,
      description:
        "## 面接情報\n\n- 面接官: 執行役員 佐藤氏\n- 形式: オンライン (Zoom)\n\n## 準備\n\n- 志望動機の最終整理\n- 逆質問3つ用意\n- `技術力 × ビジネス理解` の軸で話す",
    },
    {
      slug: "e4",
      title: "1on1 with マネージャー",
      startTime: at("17:00"),
      endTime: at("17:30"),
      projectSlug: null,
      meetUrl: "https://meet.google.com/xyz-uvwx-rst",
      hasAttachments: false,
      description:
        "- 今週の振り返り\n- 来週の優先順位確認\n- キャリアの相談（転職活動の進捗共有）",
    },
    {
      slug: "e5",
      title: "もくもく会",
      startTime: at("21:00"),
      endTime: at("23:00"),
      projectSlug: null,
      meetUrl: "https://meet.google.com/moku-moku-kai",
      hasAttachments: false,
      description: "オンラインもくもく会\n\n- 各自作業\n- 30分ごとに進捗共有",
    },
  ];

  const eventSlugToId = new Map<string, string>();
  for (const seed of eventSeeds) {
    const projectId = seed.projectSlug
      ? (projectSlugToId.get(seed.projectSlug) ?? null)
      : null;
    const e = await createEvent(supabase, {
      title: seed.title,
      startTime: seed.startTime,
      endTime: seed.endTime,
      projectId,
      meetUrl: seed.meetUrl,
      hasAttachments: seed.hasAttachments,
      description: seed.description,
    });
    eventSlugToId.set(seed.slug, e.id);
  }

  // 3. tasks
  const taskSeeds: {
    projectSlug: string;
    title: string;
    estimatedMinutes: number;
    stackOrder: number;
    dependsOnEventSlug: string | null;
    body: string;
  }[] = [
    {
      projectSlug: "career",
      title: "面接対策：志望動機の最終整理",
      estimatedMinutes: 45,
      stackOrder: 0,
      dependsOnEventSlug: "e3",
      body:
        "## やること\n\n- **志望動機**を3パターン用意\n- 技術的な強みの整理\n  - DDD / Clean Architecture\n  - SLI/SLO導入経験\n- 逆質問リストの準備\n\n## 参考\n\n`転職ドラフト`のフィードバックを確認\n\n> 上流工程への関与意欲が伝わる内容にすること",
    },
    {
      projectSlug: "slo",
      title: "SLI定義ドキュメント更新",
      estimatedMinutes: 40,
      stackOrder: 1,
      dependsOnEventSlug: "e2",
      body:
        "## 対象\n\nWeb Cart フロントエンドの SLI\n\n## 更新内容\n\n- Availability SLI: `成功リクエスト / 全リクエスト`\n- Latency SLI: `p99 < 500ms`\n- 計測ポイントをNew Relicの`Transaction`に合わせる",
    },
    {
      projectSlug: "loadtest",
      title: "WireMock stub定義作成",
      estimatedMinutes: 35,
      stackOrder: 2,
      dependsOnEventSlug: null,
      body:
        "chaos test用のstub定義ファイルを作成する\n\n### エンドポイント\n\n1. `/api/v1/orders` — 正常レスポンス\n2. `/api/v1/orders` — 429 レスポンス (rate limit)\n3. `/api/v1/payments` — 500ms遅延",
    },
    {
      projectSlug: "career",
      title: "職務経歴書PDF最終版を送付",
      estimatedMinutes: 15,
      stackOrder: 3,
      dependsOnEventSlug: null,
      body:
        "最終版PDFを浅野さんにメール送付\n\n確認ポイント:\n- 誤字脱字チェック済み\n- BASE在籍期間の記載が正確か",
    },
    {
      projectSlug: "tasuki",
      title: "AnalyzerContract trait設計",
      estimatedMinutes: 90,
      stackOrder: 4,
      dependsOnEventSlug: null,
      body:
        "## 目的\n\ncode-inspector用の抽象化層を設計する\n\n## 設計メモ\n\n```rust\ntrait AnalyzerContract {\n    fn analyze(&self, input: &SourceFile) -> AnalysisResult;\n    fn supports(&self, file_type: &FileType) -> bool;\n}\n```\n\n- php-parser と tree-sitter の両方に対応\n- call chain 解析は別traitに分離",
    },
    {
      projectSlug: "loadtest",
      title: "Locustシナリオ実装",
      estimatedMinutes: 120,
      stackOrder: 5,
      dependsOnEventSlug: null,
      body:
        "ピーク負荷パターンのシナリオを実装\n\n## 要件\n\n- 通常: 100 RPS\n- ピーク: 500 RPS (10分間)\n- ramp-up: 5分\n\n## メモ\n\n分散モードで ECS 上に展開予定",
    },
  ];

  for (const seed of taskSeeds) {
    const projectId = projectSlugToId.get(seed.projectSlug);
    if (!projectId) continue;
    const created = await createTask(supabase, {
      projectId,
      title: seed.title,
      body: seed.body,
      estimatedMinutes: seed.estimatedMinutes,
      stackOrder: seed.stackOrder,
    });
    if (seed.dependsOnEventSlug) {
      const eventId = eventSlugToId.get(seed.dependsOnEventSlug);
      if (eventId) {
        await updateTask(supabase, created.id, { dependsOnEventId: eventId });
      }
    }
  }
}

/**
 * 現ユーザーの tasks / events / projects を全削除する。
 * tasks → events の順で消す (tasks.depends_on_event_id の FK を考慮)。
 * projects は ON DELETE SET NULL なので最後に消して OK。
 */
export async function clearAllUserData(supabase: Sb): Promise<void> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("not authenticated");
  const uid = user.id;
  // RLS が効いているので user_id 絞り込みは念押しだが明示しておく
  await supabase.from("tasks").delete().eq("user_id", uid);
  await supabase.from("events").delete().eq("user_id", uid);
  await supabase.from("projects").delete().eq("user_id", uid);
}
