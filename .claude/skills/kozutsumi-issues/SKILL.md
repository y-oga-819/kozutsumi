---
name: kozutsumi-issues
description: kozutsumi リポジトリの Issue / Milestone / Phase 計画 / ADR 運用ルール。次にやるタスクを選ぶ、新規 issue を起票する（roadmap / idea）、issue を close する、idea backlog を棚卸す、新しい Phase を計画する（Milestone 作成 + issue 一括起票 + ADR 起票）、stock / flow に沿ってドキュメントを更新する、などの作業で必ず参照する。GitHub Issues / Milestones / Phase / Roadmap / ADR の話題が出たら invoke する。
---

# kozutsumi Issue / Milestone 運用

このリポジトリは **人間があまり見ない前提** で、AI が優先度判断と着手計画に使うための
構造化情報源として GitHub を運用する。本 skill は以下の場面で必ず参照する:

- 次にやる issue を選ぶ
- 新しい issue を起票する（roadmap / idea）
- issue を close する（PR マージ後）
- idea backlog を棚卸しする
- 新しい Phase を計画する（Milestone 作成 + issue 一括起票 + ADR 起票）
- ドキュメントを更新する（stock / flow の振り分けに沿って）

---

## 1. 情報の振り分け: stock と flow

kozutsumi では情報を **stock（蓄積される価値）** と **flow（流れる作業）** で切り分ける。

- **stock**: markdown にコミットする。長期的に参照される。
- **flow**: GitHub（Issue / PR / Milestone / コミットログ）で管理する。完了したら流れる。

**原則**: **「コードが仕様」**。実装済みの挙動は code を読めば分かる。
markdown には「コードから読み取れない判断（なぜ・何を・どの方向性）」だけを残す。

### レイヤー早見表

| レイヤー | 種別 | 場所 | 粒度 | 主な更新タイミング |
|---|---|---|---|---|
| なぜ / 差別化 | stock | `docs/design/vision.md` | プロダクト全体 | 方針転換時のみ |
| アーキ構造 | stock | `docs/design/architecture.md` | 全体 | 技術選定変更時 |
| UI 詳細 / KPI | stock | `docs/design/feature-spec.md` | 機能 | 設計変更時 |
| 競合分析 | stock | `docs/design/competitive-analysis.md` | 競合 | 外部状況の変化時 |
| **個別の設計判断** | **stock** | **`docs/adr/NNNN-*.md`** | 1判断 | **判断した時に起票** |
| Phase の順序 / 検証仮説 | stock | `docs/roadmap.md` | Phase 単位 | Phase 完了ごと |
| 未解決の論点 | flow | `docs/open-questions.md` | 論点1つ | 出た時 / 決着時 |
| Phase の箱 | flow | GitHub **Milestone** | Phase | Phase 開始時に作成、完了時に close |
| 1機能単位 | flow | GitHub **Issue** (`type:roadmap`) | 実装タスク | 起票 → 実装 → close |
| 後でやる置き場 | flow | GitHub **Issue** (`type:idea`) | アイデア | 思いついた瞬間に起票 |
| 実装成果物 | flow | GitHub **PR** | 1 issue 分 | 実装のたび |

「なぜ作ってるか」→ docs を見る。「今何をやるか」→ issue を見る。
「なぜこう設計したか」→ ADR を見る。

### 使わない / 作らないもの

- `docs/specs/phaseN.md` のような Phase ごとの長い実装仕様書は作らない。
  spec は flow なので markdown として残す価値が低い（コードが正）。
  Phase 計画時の設計議論は ADR 化し、実装単位は issue に分解する。
- `phase-N` ラベル: Phase は Milestone で管理するので作らない。

---

## 2. ラベル体系

### Type ラベル（必須・1 issue = 1つ）

- `type:roadmap` — vision / roadmap に紐づく機能開発
- `type:devex` — 開発中に出た改善（CI / lint / tooling / 依存更新）
- `type:idea` — 精査前の思いつき、後でやるかもしれない置き場

### 補助ラベル（任意）

- `epic` — 複数 issue をまとめる親
- 機能ドメイン: `infra` / `auth` / `crud` / `time-tracking` / `action-log` など

---

## 3. Issue 起票ルール

起票時は **Issue Form** (`.github/ISSUE_TEMPLATE/*.yml`) を使う:

- `roadmap.yml` — roadmap 系の機能開発
- `idea.yml` — 後でやる置き場
- Epic は blank issue で作成し `epic` ラベルを付ける（専用テンプレなし）

### 重要な制約

- form の見出し（`### 目的` / `### 前提・依存` など）は **編集しない**。AI がパースする前提。
- 迷ったら `type:idea` に投げて OK。棚卸し時に昇格 or close を判断する。

---

## 4. 次やるタスクの選び方（AI）

1. 現在進行中の Milestone の **open** issue を `list_issues` で取得
   （現時点では `Phase1：コアUI` = Milestone #2）
2. 各 issue の `### 前提・依存` を読み、`Depends on` が全て解決済みのものだけ候補化
3. 候補のうち、`### 見積もり規模` と手空き時間を見て1つ選ぶ
4. Epic (`epic` ラベル) は直接実装しない。子 issue を選ぶ
5. 迷ったら人間に聞く（候補を2-3個並べて判断を仰ぐ）

---

## 5. Phase 開始時の手順

新しい Phase を開始する時は以下を順に行う:

1. **`docs/roadmap.md` の該当 Phase を読み直す**（既存）
2. **大きな設計判断があれば ADR を書く** (`docs/adr/NNNN-*.md`)
   - 例: 技術選定、スコープ境界、差別化に関わる判断、データ保持戦略
3. **Milestone を作成**（GitHub UI で手動、MCP は作成 API 未対応）
   - Title: `PhaseN：<短い説明>`
   - Description: 1〜2行サマリ + `roadmap.md` へのリンク。
     検証仮説等の詳細は roadmap.md に書いてあるので**コピペしない**（二重管理防止）
4. **Issue を一括起票** (`roadmap.yml` 準拠)
   - 親 Epic + 子 issue の構造
   - `type:roadmap` ラベル + 該当 Milestone を付与
   - `Depends on` を明記して着手順を表現

**書かないもの**: `docs/specs/phaseN.md` のような長大な実装仕様書。
spec は flow なので、実装単位の issue と code に分解する。

---

## 6. 開発中: 気づきが発生した時

- 「今じゃないけど後でやりたい」→ Issue Form `idea.yml` で起票（`type:idea`）
- 「現在の Phase でやるべき」→ `type:roadmap` で起票 + 現 Milestone に割当
- 「アーキ / 差別化レベルの判断を下した」→ ADR を起票

基本は現 Phase の完遂を優先する。idea issue は棚卸しで処理する。

---

## 7. 更新タイミング早見表

| イベント | docs | ADR | Issue | Milestone |
|---|---|---|---|---|
| 方針転換 | vision / architecture 更新 | 新 ADR | — | — |
| Phase 計画 | — | 新 ADR（大きな判断）| roadmap issue 一括起票 | `PhaseN` 作成 |
| 1 issue 着手 | — | — | 実装 → PR → close | — |
| 設計判断を下した | — | 新 ADR | — | — |
| 気づき発生 | — | — | idea issue 起票 | — |
| 論点発生 | `open-questions.md` 追記 | — | — | — |
| 論点決着 | `open-questions.md` から削除 | 新 ADR | — | — |
| Phase 完了 | `roadmap.md` の Phase に ✅ | — | — | `PhaseN` を close |
| 棚卸し（月1 / Phase 切れ目） | — | — | idea の昇格 / close 提案 | — |

---

## 8. 現在の状態（クイックリファレンス）

- **進行中 Milestone**: `Phase1：コアUI` (#2)
- **Phase 1 の子 issue**: #22 (Epic), #23, #24 (closed), #25 (closed), #26, #27
- **Milestone 一覧**:
  - #2 `Phase1：コアUI` — 進行中
  - #3 `Phase2：Googleカレンダー連携`
  - #4 `Phase3：AIサジェスト+見積もり補正`
  - #5 `Phase4：2段階提案+行動分析`

この情報は古くなる可能性があるので、実作業前に `list_issues` で最新を取得すること。
