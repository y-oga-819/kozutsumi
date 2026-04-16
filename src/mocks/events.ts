import type { Event } from "../entities/event/types";
import { TODAY } from "./today";

export const initialEvents: Event[] = [
  {
    id: "e2",
    title: "SLOレビューMTG",
    time: "09:30",
    endTime: "10:30",
    date: TODAY,
    project: "slo",
    meetUrl: "https://meet.google.com/abc-defg-hij",
    attachments: ["SLI定義書_v2.pdf", "エラーバジェットポリシー草案.docx"],
    description:
      "## アジェンダ\n\n1. SLI定義の最終確認\n2. エラーバジェットポリシーのレビュー\n3. New Relicダッシュボードのデモ\n\n## 参加者\n\n- 田中PM\n- インフラチーム\n- 自分",
  },
  {
    id: "e1",
    title: "デイリースタンドアップ",
    time: "11:00",
    endTime: "11:15",
    date: TODAY,
    description:
      "チーム全体の進捗共有\n- 各自の今日のタスク確認\n- ブロッカーの共有",
  },
  {
    id: "e3",
    title: "Dirbato最終面接",
    time: "14:00",
    endTime: "15:00",
    date: TODAY,
    project: "career",
    meetUrl: "https://zoom.us/j/123456789",
    attachments: ["職務経歴書_最終版.pdf"],
    description:
      "## 面接情報\n\n- 面接官: 執行役員 佐藤氏\n- 形式: オンライン (Zoom)\n\n## 準備\n\n- 志望動機の最終整理\n- 逆質問3つ用意\n- `技術力 × ビジネス理解` の軸で話す",
  },
  {
    id: "e4",
    title: "1on1 with マネージャー",
    time: "17:00",
    endTime: "17:30",
    date: TODAY,
    meetUrl: "https://meet.google.com/xyz-uvwx-rst",
    description:
      "- 今週の振り返り\n- 来週の優先順位確認\n- キャリアの相談（転職活動の進捗共有）",
  },
  {
    id: "e5",
    title: "もくもく会",
    time: "21:00",
    endTime: "23:00",
    date: TODAY,
    meetUrl: "https://meet.google.com/moku-moku-kai",
    description: "オンラインもくもく会\n\n- 各自作業\n- 30分ごとに進捗共有",
  },
];
