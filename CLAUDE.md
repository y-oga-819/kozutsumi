# kozutsumi

個人特化AI秘書システム。最初のアプリケーションはタスク管理。使い続けるほど行動パターンから学習し、「自分専用の秘書」が育つ。

## 作業開始時のルール

**新しい会話で最初にやること: [docs/design/vision.md](docs/design/vision.md) を必ず読む。**

理由: kozutsumi の差別化は「行動パターン分析の深さ」にある。機能レベルで競合と比較する判断をしないために、毎回ビジョンを念頭に置く。

## ドキュメント

| ファイル | 役割 |
|---|---|
| [docs/design/vision.md](docs/design/vision.md) | プロダクトの何・誰・なぜ・差別化の核。**毎回読む** |
| [docs/design/architecture.md](docs/design/architecture.md) | 解決策の構造 / データモデル / 技術スタック |
| [docs/design/feature-spec.md](docs/design/feature-spec.md) | UI機能詳細 / KPI |
| [docs/design/competitive-analysis.md](docs/design/competitive-analysis.md) | 競合（Sunsama / Motion）の詳細分析 |
| [docs/roadmap.md](docs/roadmap.md) | Phase 1〜4 + 将来構想 |
| [docs/open-questions.md](docs/open-questions.md) | 未解決の論点と現時点の方針 |
| [docs/specs/phase1.md](docs/specs/phase1.md) | Phase 1 実装指示 |

## 命名規約

- プロジェクト名は **kozutsumi** で統一する
- `flowstack` は旧名。今後のドキュメント・コード・コミットでは使わない

## Issue / Milestone 運用

人間はあまり見ない前提で、AI が優先度判断と着手計画に使うための構造化情報源として運用する。

### 何がどこにあるか

| レイヤー | 場所 | 粒度 | 主な更新タイミング |
|---|---|---|---|
| なぜ / 差別化 | `docs/design/vision.md` | プロダクト全体 | 方針転換時のみ |
| 何を / 構造 | `docs/design/architecture.md` | 全体 | 技術選定変更時 |
| どの順で | `docs/roadmap.md` | Phase 単位 | Phase 完了ごと |
| Phase N の仕様 | `docs/specs/phaseN.md` | 1 Phase | Phase 計画時に作成 |
| 論点 | `docs/open-questions.md` | 論点1つ | 出た時 / 決着時 |
| Phase の箱 | GitHub **Milestone** | Phase | Phase 開始時に作成、完了時に close |
| 1機能単位 | GitHub **Issue** (`type:roadmap`) | 実装タスク | 起票 → 実装 → close |
| 後でやる置き場 | GitHub **Issue** (`type:idea`) | アイデア | 思いついた瞬間に起票 |
| 実装成果物 | GitHub **PR** | 1 issue 分 | 実装のたび |

「なぜ作ってるか」は docs を見る。「今何をやるか」は issue を見る。

### ラベル体系

- **Type ラベル (必須・1 issue = 1つ)**
  - `type:roadmap` — vision / roadmap に紐づく機能開発
  - `type:devex` — 開発中に出た改善（CI / lint / tooling / 依存更新）
  - `type:idea` — 精査前の思いつき、後でやるかもしれない置き場
- **その他ラベル (任意)**
  - `epic` — 複数 issue をまとめる親
  - 機能ドメイン: `infra` / `auth` / `crud` / `time-tracking` / `action-log` など（補助）
- **使わないラベル**
  - `phase-N` — Phase は **Milestone で管理する**。ラベルで二重管理しない

### Issue 起票ルール

- 起票時は **Issue Form** を使う: `.github/ISSUE_TEMPLATE/roadmap.yml` または `idea.yml`
- form の見出し（`### 目的` / `### 前提・依存` など）は**編集しない**。AI がパースする前提
- 迷ったら `type:idea` に投げてOK。棚卸し時に昇格 or close を判断
- Epic は blank issue で作成し `epic` ラベルを付ける（専用テンプレなし）

### 次やるタスクの選び方（AI）

1. 現在進行中の Milestone（今は `Phase1：コアUI` = #2）の **open** issue を `list_issues` で取得
2. 各 issue の `### 前提・依存` を読み、Depends on が全て解決済みのものだけ候補化
3. 候補のうち、`### 見積もり規模` と手空き時間を見て1つ選ぶ
4. Epic (#22 など) は直接実装しない。子 issue を選ぶ

### 更新タイミング早見表

| イベント | docs | Issue | Milestone |
|---|---|---|---|
| 方針転換 | vision / architecture 更新 | — | — |
| Phase 計画 | `specs/phaseN.md` 作成 | roadmap issue 一括起票 | `Phase N` 作成 |
| 1 issue 着手 | — | 実装 → PR → close | — |
| 気づき発生 | — | idea issue 起票 | — |
| 設計論点 | `open-questions.md` 追記 | — | — |
| Phase 完了 | `roadmap.md` の Phase に ✅ | — | `Phase N` を close |
| 棚卸し（月1 / Phase 切れ目） | — | idea の昇格 / close 提案 | — |
