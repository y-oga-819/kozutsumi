---
name: kozutsumi-adr
description: kozutsumi リポジトリの ADR (Architecture Decision Record) 運用ルール。設計判断を ADR 化する、ADR の粒度を判定する、既存 ADR を supersede する、Phase 計画時の設計判断を整理する、などの作業で必ず参照する。`docs/adr/` 配下のファイルを書く / 編集する話題、設計判断 / アーキ判断 / トレードオフ / supersede の話題が出たら invoke する。
---

# kozutsumi ADR 運用

ADR (Architecture Decision Record) は kozutsumi の設計判断を**1 判断 = 1 ファイル**で残す stock。
`docs/adr/NNNN-<kebab-title>.md` に置く。テンプレートは `docs/adr/0000-template.md`。

本 skill は以下の場面で必ず参照する:

- 設計判断を下したので ADR を起票する
- Phase 計画で大きな設計判断を ADR 化する（`kozutsumi-issues` から呼ばれる）
- 既存 ADR を supersede / Deprecated にする
- ADR の粒度に迷う / 1 ADR にまとめるか分けるか判断する
- `open-questions.md` の論点が決着して ADR 化する

---

## 1. 粒度の原則（最重要）

ADR は **「1 判断 = 1 ADR」**。その ADR を Deprecated にするだけで、他の判断がクリーンに残る粒度にする。

### 判断の切り方

**「将来 supersede される trigger が独立しているか」** で判定する。
別の trigger で廃止されうるものは別 ADR に分ける。

例（Phase 2 の Google Calendar 同期周り）:

| 判断 | supersede trigger | 別 ADR にする？ |
|---|---|---|
| 同期実行を Next.js Route Handler で行う | 別基盤（Edge Function 等）に移す | ✅ 独立 |
| 同期方式は full sync → syncToken 段階採用 | webhook / 別方式に切り替える | ✅ 独立 |
| 同期トリガーは手動 + 起動時遅延 | cron / 定期実行を導入 | ✅ 独立 |
| 同期対象は primary カレンダーのみ | 複数カレンダー対応 | ✅ 独立 |
| provider token の refresh は自前実装 | Supabase が自動 refresh 対応 | ✅ 独立 |

これらは互いに独立に廃止されうるので、それぞれ別 ADR にする。

### ADR にしないもの（パラメータ・実装詳細）

以下は ADR に書かず、**code の constant** や **issue の本文**に置く:

- 閾値・時間窓・タイムアウト等の数値（例: 同期間隔 15 分、取得期間 7 日〜30 日）
- API endpoint の URL、ライブラリのバージョン
- ファイル配置、命名規則の詳細
- 一時的なワークアラウンド

判定基準: **「この値を変えるたびに ADR を 1 本書くのは不毛」**と感じるなら ADR ではない。

### ADR 間の前提関係は `Related` で

判断 A が判断 B を前提にする場合（例: トリガー設計は実行場所が決まっている前提）、
A の `Related` に B を書く。本文に B の内容を再掲しない（重複の元）。

---

## 2. 書き終えた時のセルフチェック

ADR を書いたら以下を確認する:

- [ ] この ADR 1 枚を Deprecated にした時、他の判断はクリーンに残るか
- [ ] 判断以外（パラメータ・実装詳細）が混ざっていないか
- [ ] 依存する他の ADR を `Related` に書いたか
- [ ] `Status` が `Accepted` / `Proposed` / `Deprecated` / `Superseded by ADR-XXXX` のいずれかになっているか
- [ ] `Date` が今日になっているか

複数の判断が混ざっていることに気づいたら、書き直して分割する。

---

## 3. ファイル名と番号

- ファイル名: `docs/adr/NNNN-<kebab-case-title>.md`（4 桁ゼロ埋め）
- 番号は連番で採番。既存の最大番号 + 1
- タイトルは判断の結論が一目で分かるもの（例: `0005-google-calendar-sync-via-route-handler.md`）

採番の確認:

```bash
ls docs/adr/ | grep -E '^[0-9]+-' | sort | tail -3
```

---

## 4. テンプレート

`docs/adr/0000-template.md` をコピーして書き始める。セクション構成:

- `Status` / `Date` / `Related`
- `Context` — なぜこの判断が必要になったか
- `Decision` — 何を決めたか（端的に 1〜3 文）
- `Consequences` — 肯定的影響 / 否定的影響・トレードオフ
- `Alternatives considered` — 検討して採らなかった選択肢と理由
- `Notes` — 補足、参考リンク、将来見直す条件

---

## 5. supersede / Deprecated にする時

判断を覆す時は **古い ADR を編集 + 新 ADR を起票** する:

1. 新しい ADR を起票（`Status: Accepted` / `Related: Supersedes ADR-XXXX`）
2. 古い ADR の `Status` を `Superseded by [ADR-YYYY](./YYYY-...)` に書き換える
3. 古い ADR の本文は**消さない**（履歴として残す。後から「なぜ覆したか」を追える）

部分的な supersede（旧 ADR の一部だけ廃止）が必要になった時は、**粒度設計が間違っていた**シグナル。
旧 ADR を分割してから supersede する選択肢も検討する。

---

## 6. 既存 ADR 一覧（クイックリファレンス）

| 番号 | タイトル | Status |
|---|---|---|
| 0000 | template | — |
| 0001 | action_logs テーブルは Phase 1 から運用開始する | Accepted |
| 0002 | Google OAuth の calendar.readonly scope を Phase 1 で先行付与する | Accepted |
| 0003 | イベント駆動スタックをコア体験の中心に据える | Accepted |
| 0004 | task time-entry state machine | Accepted |
| 0005 | Google Calendar 同期は Next.js Route Handler で実行する | Accepted |
| 0006 | 同期方式は full sync → syncToken 段階採用、webhook 不採用 | Accepted |
| 0007 | 同期トリガーは手動ボタン + 起動時遅延実行 | Accepted |
| 0008 | 同期対象は primary カレンダーのみ | Accepted |
| 0009 | Google provider token の refresh は自前実装 | Accepted |
| 0010 | google_calendar イベントは Google 側属性 read-only | Accepted |

この情報は古くなる可能性があるので、実作業前に `ls docs/adr/` で最新を取得すること。

---

## 7. 関連する skill

- **`kozutsumi-issues`** — issue / Milestone / PR の運用。Phase 計画は本 skill と連携する
  （Phase 計画フローでは先に本 skill で ADR を起票し、確定後に `kozutsumi-issues` で Milestone と issue を起票する）
