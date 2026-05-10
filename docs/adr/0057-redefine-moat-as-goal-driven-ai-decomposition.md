# ADR 0057: 差別化の核を「ゴール駆動の AI 分解」に再定義する

- **Status**: Accepted
- **Date**: 2026-05-10
- **Related**: `docs/design/vision.md` / `docs/design/architecture.md` / [Issue #234](https://github.com/y-oga-819/kozutsumi/issues/234) / [ADR-0058](./0058-timer-three-verbs-and-no-ai-interruption.md) / [ADR-0061](./0061-ai-decomposition-one-hour-target-and-done-condition-schema.md) / [ADR-0062](./0062-morning-review-ritual-fifteen-minutes.md) / [ADR-0064](./0064-task-creation-title-only-with-ai-template-fill.md)

## Context

想定ユーザーの行動特性 (#234 本文より: 過集中で時間を忘れる / 興味の有無で進捗が極端に変動 / ゴールが見えないタスクで詰まる / 強制的な時間制限で集中が切れる) を踏まえた 4 領域 (神経多様性向けタスク管理 / 行動経済学 / ゲーミフィケーション / 異分野報酬設計) の調査統合シンセシスで、現 vision の差別化軸「行動ベース」(`docs/design/vision.md` L62) は維持できるが、表層体験の核を別軸に置く必要が浮上した。

調査 4 本横断で最も強く支持された方向は「ドリルダウン型ゴール体験」/「AI 分解」であり、Solanto / Mahan / 小鳥遊 / Davis / Khan Academy 等が独立に同じ処方を支持している。Motion との対比軸も明快化する: Motion は 60 分タスクをそのままスケジュールするが、kozutsumi は 60 分に到達できる単位に砕いてからスケジュールする。

## Decision

差別化の核を以下の 2 層で再定義する:

- **表層 (体験)**: でかいタスクをそのまま放置せず、**1 時間単位でゴールを追いかけられる粒度**に AI が分割し続ける
- **深層 (基盤)**: 行動データ蓄積による**分解精度の個人最適化** (現「行動ベース」差別化軸はここに残す)

## Consequences

### 肯定的影響

- 「Motion: 60 分そのまま / kozutsumi: 60 分に砕く」という一貫したメッセージで対外競合差別化を語れる
- 想定ユーザー特性 (3) ゴールが見えないタスクで詰まる、への直接処方になる
- 既存「行動ベース」軸を捨てるのではなく、AI 分解の精度を上げる学習素材として深層に再配置するため、これまでの行動ログ系 ADR (0001 / 0035 / 0051 / 0054 等) の投資は保全される

### 否定的影響・トレードオフ

- `docs/design/vision.md` / `docs/design/feature-spec.md` / `docs/design/architecture.md` の差別化軸節を書き換える必要がある
- 「per-task 予実計測」「タイマー駆動」「行動ベーススケジューリング」は中核から「分解精度を上げるための学習素材」というポジションに移る
- KPI も「見積もり精度 ±20%」中心から「定着 + インサイト精度」中心に組み替える必要がある (具体方針は別途決定)

## Alternatives considered

- **現状維持 (vision そのまま) + ドッグフードで判断**: 学術的に既知のパターン (Wall of Awful / Heart 型強制中断の害) を再発見するだけになる懸念。不採用
- **観測専用に倒す (timer / per-task を観測のみにし、UX の中心を Wrapped 型インサイトに置く)**: 既存 ADR-0003 / 0004 / 0024-0026 を広範に supersede する必要があり、リプレース工数大。不採用
- **Quest Log / Skill Tree 寄りに転換**: 実質「別アプリ」。投資保全がほぼゼロ。不採用

## Notes

- `docs/design/vision.md` / `docs/design/architecture.md` / `docs/design/feature-spec.md` への反映は本軌道修正の ADR 群 (0057〜0064) が出揃ってから別途実施する
- 将来見直す条件: 「1 時間ゴール単位」体験がドッグフードで効かない場合、深層側 (行動ベース蓄積) の重みを再評価する
- 関連調査原文は #234 のコメント 1〜4 に保管 (現時点では stock 化未実施)
