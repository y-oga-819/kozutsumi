---
name: kozutsumi-flow
description: kozutsumi リポジトリの GitHub flow（Issue / Milestone / PR）の運用ルール。次にやるタスクを選ぶ、新規 issue を起票する（roadmap / idea / bug）、issue を close する、PR を作成する（テンプレート / `Closes #N` の付け方）、idea backlog を棚卸す、Milestone を作成・close する、Phase 計画の flow 部分（Milestone + issue 一括起票）を実行する、などの作業で必ず参照する。GitHub Issues / Milestones / PR / Phase / バグ報告の話題が出たら invoke する。ADR / 設計判断は `kozutsumi-adr` skill が担当。
---

# kozutsumi GitHub flow 運用

このリポジトリは **人間があまり見ない前提** で、AI が優先度判断と着手計画に使うための
構造化情報源として GitHub を運用する。

本 skill は **flow（Issue / Milestone / PR）専任**。stock（ADR / docs）は `kozutsumi-adr` を参照。

本 skill は以下の場面で必ず参照する:

- 次にやる issue を選ぶ
- 新しい issue を起票する（roadmap / idea / bug）
- issue を close する（PR マージ後）
- idea backlog を棚卸しする
- Milestone を作成 / close する
- Phase 計画の flow 部分を実行する（**ADR 起票は `kozutsumi-adr` を invoke**）

---

## 1. 情報の振り分け: stock と flow

kozutsumi では情報を **stock（蓄積される価値）** と **flow（流れる作業）** で切り分ける。

- **stock**: markdown にコミットする。長期的に参照される。**`kozutsumi-adr` skill が担当**。
- **flow**: GitHub（Issue / PR / Milestone / コミットログ）で管理する。完了したら流れる。**本 skill が担当**。

**原則**: **「コードが仕様」**。実装済みの挙動は code を読めば分かる。
markdown には「コードから読み取れない判断（なぜ・何を・どの方向性）」だけを残す。

### レイヤー早見表

| レイヤー | 種別 | 場所 | 担当 skill |
|---|---|---|---|
| なぜ / 差別化 | stock | `docs/design/vision.md` | — (毎回 CLAUDE.md で読む) |
| アーキ構造 | stock | `docs/design/architecture.md` | — |
| UI 詳細 / KPI | stock | `docs/design/feature-spec.md` | — |
| 競合分析 | stock | `docs/design/competitive-analysis.md` | — |
| **個別の設計判断** | **stock** | **`docs/adr/NNNN-*.md`** | **`kozutsumi-adr`** |
| Phase の順序 / 検証仮説 | stock | `docs/roadmap.md` | — |
| 未解決の論点 | flow | `docs/open-questions.md` | 本 skill |
| Phase の箱 | flow | GitHub **Milestone** | **本 skill** |
| 1機能単位 | flow | GitHub **Issue** (`type:roadmap`) | **本 skill** |
| 後でやる置き場 | flow | GitHub **Issue** (`type:idea`) | **本 skill** |
| 不具合報告 | flow | GitHub **Issue** (`type:bug`) | **本 skill** |
| 実装成果物 | flow | GitHub **PR** | **本 skill** |

「なぜ作ってるか」→ docs を見る。「今何をやるか」→ issue を見る。
「なぜこう設計したか」→ ADR を見る（`kozutsumi-adr` 経由）。

### 使わない / 作らないもの

- `docs/specs/phaseN.md` のような Phase ごとの長い実装仕様書は作らない。
  spec は flow なので markdown として残す価値が低い（コードが正）。
  Phase 計画時の設計議論は ADR 化（`kozutsumi-adr`）し、実装単位は issue に分解する。
- `phase-N` ラベル: Phase は Milestone で管理するので作らない。

---

## 2. ラベル体系

### Type ラベル（必須・1 issue = 1つ）

- `type:roadmap` — vision / roadmap に紐づく機能開発
- `type:devex` — 開発中に出た改善（CI / lint / tooling / 依存更新）
- `type:idea` — 精査前の思いつき、後でやるかもしれない置き場
- `type:bug` — 動作不良の報告（再現手順 / 期待 / 実際 / ログ を構造化）

### 補助ラベル（任意）

- 機能ドメイン: `infra` / `auth` / `crud` / `time-tracking` / `action-log` など

---

## 3. Issue 起票ルール

起票時は **Issue Form** (`.github/ISSUE_TEMPLATE/*.yml`) を使う:

- `roadmap.yml` — roadmap 系の機能開発
- `idea.yml` — 後でやる置き場
- `bug.yml` — バグ報告（再現手順 / 期待 / 実際 / ログ / 影響範囲）

### 重要な制約

- form の見出し（`### 目的` / `### 前提・依存` など）は **編集しない**。AI がパースする前提。
- 迷ったら `type:idea` に投げて OK。棚卸し時に昇格 or close を判断する。

---

## 4. PR 作成ルール

PR の運用は厳密にしない。**対応する issue がある場合は必ず `Closes #N` でリンクする** だけが守るべきルール。
issue 無しの PR（突発の小修正・テンプレ調整など）も普通に出して OK。

### テンプレートに従う

PR 本文は `.github/PULL_REQUEST_TEMPLATE.md` の構造で書く（GitHub が自動展開）。
不要なセクション（HTML コメントだけが残るもの）は **削除して提出する**。

### 「関連 Issue」セクションの書き方

対応 issue がある場合:

```
## 関連 Issue

Closes #N
```

- `Closes` キーワードがあると、PR マージ時に GitHub が自動で issue を close する
- 複数 close する場合は `Closes #1, Closes #2` のように **`Closes` を都度書く**
  （`Closes #1, #2` のような省略形だと最初の 1 個しか効かない）
- close せず参照するだけなら `Refs #N`
- 対応 issue が無い場合は「関連 Issue」セクションごと削除して提出する
  （issue を新規起票する必要は無い）

### PR 作成前のチェック

- [ ] 対応 issue があれば「関連 Issue」セクションに `Closes #N` または `Refs #N` を記入した
- [ ] テンプレートの不要セクションは削除した
- [ ] 「Before → After」は概念やフローの変化を書いた（差分の説明ではない）

---

## 5. 次やるタスクの選び方（AI）

1. 現在進行中の Milestone の **open** issue を `list_issues` で取得
2. 各 issue の `### 前提・依存` を読み、`Depends on` が全て解決済みのものだけ候補化
3. 候補のうち、`### 見積もり規模` と手空き時間を見て1つ選ぶ
4. 迷ったら人間に聞く（候補を2-3個並べて判断を仰ぐ）

---

## 6. Phase 開始時の手順

新しい Phase を開始する時は以下を順に行う:

1. **`docs/roadmap.md` の該当 Phase を読み直す**
2. **大きな設計判断を ADR 化する** → **`kozutsumi-adr` skill を invoke**
   - 例: 技術選定、スコープ境界、差別化に関わる判断、データ保持戦略
   - ADR が確定してから次に進む
3. **Milestone を作成**（GitHub UI で手動、MCP は作成 API 未対応）
   - Title: `PhaseN：<短い説明>`
   - Description: 1〜2行サマリ + `roadmap.md` へのリンク。
     検証仮説等の詳細は roadmap.md に書いてあるので**コピペしない**（二重管理防止）
4. **Issue を一括起票** (`roadmap.yml` 準拠)
   - `type:roadmap` ラベル + 該当 Milestone を付与
   - `Depends on` を明記して着手順を表現
   - 関連する ADR を本文の参照リンクに含める
   - **親 Epic issue は作らない**。issue を束ねる役割は Milestone が担い、横断する narrative は ADR / `open-questions.md` が担うので Epic の独立価値が無い。Phase 1 / 2 では Epic (#22 / #48) を作っていたが、Phase 3 以降は廃止する。

**書かないもの**: `docs/specs/phaseN.md` のような長大な実装仕様書。
spec は flow なので、実装単位の issue と code に分解する。

---

## 7. 開発中: 気づきが発生した時

- 「今じゃないけど後でやりたい」→ Issue Form `idea.yml` で起票（`type:idea`）
- 「現在の Phase でやるべき」→ `type:roadmap` で起票 + 現 Milestone に割当
- 「動かない / 想定と違う挙動」→ Issue Form `bug.yml` で起票（`type:bug`）
- 「アーキ / 差別化レベルの判断を下した」→ **`kozutsumi-adr` skill を invoke** して ADR 起票

基本は現 Phase の完遂を優先する。idea issue は棚卸しで処理する。
バグは緊急度に応じて現 Phase の合間に差し込む（high なら即着手、low/mid は棚卸しで判断）。

---

## 8. 更新タイミング早見表

| イベント | docs | ADR | Issue | Milestone | 担当 skill |
|---|---|---|---|---|---|
| 方針転換 | vision / architecture 更新 | 新 ADR | — | — | `kozutsumi-adr` |
| Phase 計画 | — | 新 ADR（大きな判断）| roadmap issue 一括起票 | `PhaseN` 作成 | 本 skill + `kozutsumi-adr` |
| 1 issue 着手 | — | — | 実装 → PR → close | — | 本 skill |
| 設計判断を下した | — | 新 ADR | — | — | `kozutsumi-adr` |
| 気づき発生 | — | — | idea issue 起票 | — | 本 skill |
| バグ発生 | — | — | bug issue 起票 (`type:bug`) | — | 本 skill |
| 論点発生 | `open-questions.md` 追記 | — | — | — | 本 skill |
| 論点決着 | `open-questions.md` から削除 | 新 ADR | — | — | `kozutsumi-adr` |
| Phase 完了 | `roadmap.md` の Phase に ✅ | — | — | `PhaseN` を close | 本 skill |
| 棚卸し（月1 / Phase 切れ目） | — | — | idea の昇格 / close 提案 | — | 本 skill |

---

## 9. 関連する skill

- **`kozutsumi-adr`** — ADR / 設計判断の運用。Phase 計画では先に invoke して ADR を確定させる。
