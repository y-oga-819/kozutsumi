import type { Event } from "@/entities/event/types";
import { todayIso } from "@/shared/lib/time";

function at(date: string, hhmm: string): string {
  // ローカルタイムの ISO 文字列 (タイムゾーン情報なし)。new Date() でパースするとローカルとして扱われる。
  return `${date}T${hhmm}:00`;
}

/**
 * サンプルイベント生成器。今日の日付を基準にイベントを生成する。
 */
export function buildInitialEvents(): Event[] {
  const today = todayIso();
  const now = new Date().toISOString();
  const base = {
    source: "manual" as const,
    externalId: null,
    createdAt: now,
  };

  return [
    {
      ...base,
      id: "e2",
      title: "SLOレビューMTG",
      startTime: at(today, "09:30"),
      endTime: at(today, "10:30"),
      projectId: "slo",
      meetUrl: "https://meet.google.com/abc-defg-hij",
      hasAttachments: true,
      description:
        "## アジェンダ\n\n1. SLI定義の最終確認\n2. エラーバジェットポリシーのレビュー\n3. New Relicダッシュボードのデモ\n\n## 参加者\n\n- 田中PM\n- インフラチーム\n- 自分",
    },
    {
      ...base,
      id: "e1",
      title: "デイリースタンドアップ",
      startTime: at(today, "11:00"),
      endTime: at(today, "11:15"),
      projectId: null,
      meetUrl: null,
      hasAttachments: false,
      description: "チーム全体の進捗共有\n- 各自の今日のタスク確認\n- ブロッカーの共有",
    },
    {
      ...base,
      id: "e3",
      title: "Dirbato最終面接",
      startTime: at(today, "14:00"),
      endTime: at(today, "15:00"),
      projectId: "career",
      meetUrl: "https://zoom.us/j/123456789",
      hasAttachments: true,
      description:
        "## 面接情報\n\n- 面接官: 執行役員 佐藤氏\n- 形式: オンライン (Zoom)\n\n## 準備\n\n- 志望動機の最終整理\n- 逆質問3つ用意\n- `技術力 × ビジネス理解` の軸で話す",
    },
    {
      ...base,
      id: "e4",
      title: "1on1 with マネージャー",
      startTime: at(today, "17:00"),
      endTime: at(today, "17:30"),
      projectId: null,
      meetUrl: "https://meet.google.com/xyz-uvwx-rst",
      hasAttachments: false,
      description: "- 今週の振り返り\n- 来週の優先順位確認\n- キャリアの相談（転職活動の進捗共有）",
    },
    {
      ...base,
      id: "e5",
      title: "もくもく会",
      startTime: at(today, "21:00"),
      endTime: at(today, "23:00"),
      projectId: null,
      meetUrl: "https://meet.google.com/moku-moku-kai",
      hasAttachments: false,
      description: "オンラインもくもく会\n\n- 各自作業\n- 30分ごとに進捗共有",
    },
  ];
}
