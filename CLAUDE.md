# kozutsumi

個人特化AI秘書システム。最初のアプリケーションはタスク管理。使い続けるほど行動パターンから学習し、「自分専用の秘書」が育つ。

## 作業開始時のルール

**新しい会話で最初にやること: [docs/design/vision.md](docs/design/vision.md) を必ず読む。**

理由: kozutsumi の差別化は「行動パターン分析の深さ」にある。機能レベルで競合と比較する判断をしないために、毎回ビジョンを念頭に置く。

## 情報の置き場: stock と flow

kozutsumi では情報を **stock（蓄積される価値）** と **flow（流れる作業）** で切り分ける。

- **stock** は markdown にコミットする（長期参照される）
- **flow** は GitHub（Issue / PR / Milestone / コミットログ）で管理する（完了したら流れる）

原則: **「コードが仕様」**。実装済みの挙動はコードが正。markdown には「コードから読み取れない判断」だけを残す。

### ドキュメント（stock）

| ファイル | 役割 |
|---|---|
| [docs/design/vision.md](docs/design/vision.md) | プロダクトの何・誰・なぜ・差別化の核。**毎回読む** |
| [docs/design/architecture.md](docs/design/architecture.md) | 解決策の構造 / データモデル / 技術スタック |
| [docs/design/feature-spec.md](docs/design/feature-spec.md) | UI機能詳細 / KPI |
| [docs/design/competitive-analysis.md](docs/design/competitive-analysis.md) | 競合（Sunsama / Motion）の詳細分析 |
| [docs/adr/](docs/adr/) | **個別の設計判断の記録（ADR）**。判断したら必ず起票 |
| [docs/roadmap.md](docs/roadmap.md) | Phase 1〜4 + 将来構想 |
| [docs/open-questions.md](docs/open-questions.md) | 未解決の論点と現時点の方針（決着したら ADR 化して削除） |

**Phase ごとの実装仕様書 (`docs/specs/phaseN.md`) は作らない**。spec は flow（コードが正）なので、Phase 計画時の設計議論は ADR に、実装単位は issue に分解する。

### 作業管理（flow）

GitHub Issue / Milestone / PR で管理する。詳細は skill 参照（次セクション）。

## Skills（開発フローの実装）

このリポジトリでは開発フロー・ドキュメント運用のルールを **skill** として `.claude/skills/` に定義している。該当する作業をするときは skill を自動で invoke して参照すること。

| skill | いつ invoke するか |
|---|---|
| [`kozutsumi-issues`](.claude/skills/kozutsumi-issues/SKILL.md) | 次の issue を選ぶ / 起票 / close / 棚卸し / Milestone 操作 / Phase 計画の flow 部分（**flow 専任**） |
| [`kozutsumi-adr`](.claude/skills/kozutsumi-adr/SKILL.md) | 設計判断を ADR 化 / ADR の粒度判定 / supersede / Phase 計画の設計判断整理（**stock 専任**） |
| [`kozutsumi-frontend-a11y`](.claude/skills/kozutsumi-frontend-a11y/SKILL.md) | React component の新規実装・構造変更 / modal / tabs / form / icon-only ボタン / `role` / `aria-*` 判断 / a11y レビュー / e2e locator 衝突時 |

skill を invoke せずに issue 運用や Phase 計画、ADR 起票を行わないこと。運用の一貫性は skill の内容で担保している。
Phase 計画は両 skill をまたぐ compound 作業（先に `kozutsumi-adr` で ADR 確定 → `kozutsumi-issues` で Milestone + issue 起票）。

## 命名規約

- プロジェクト名は **kozutsumi** で統一する
- `flowstack` は旧名。今後のドキュメント・コード・コミットでは使わない
