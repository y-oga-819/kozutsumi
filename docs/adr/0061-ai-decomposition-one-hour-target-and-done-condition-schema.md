# ADR 0061: AI 分解は 1 時間粒度を推奨目安 + 完了条件 (Goal / Done / First step) を AI が言語化

- **Status**: Accepted
- **Date**: 2026-05-10
- **Related**: `docs/design/architecture.md` §1.3 / [Issue #234](https://github.com/y-oga-819/kozutsumi/issues/234) / [ADR-0017](./0017-ai-task-decomposition-async.md) / [ADR-0049](./0049-remove-ai-decompose-children-count-limit.md) / [ADR-0053](./0053-decompose-child-estimate-honesty.md) / [ADR-0055](./0055-parallelogram-progress-wrap-for-large-n.md) / [ADR-0057](./0057-redefine-moat-as-goal-driven-ai-decomposition.md) / [ADR-0058](./0058-timer-three-verbs-and-no-ai-interruption.md) / [ADR-0064](./0064-task-creation-title-only-with-ai-template-fill.md)

## Context

ADR-0057 で差別化の核を「ゴール駆動の AI 分解」(Motion: 60 min そのまま / kozutsumi: 60 min に到達できる単位に砕く) と再定義した。これに合わせて AI 分解の出力 schema と粒度を確定する必要がある。

調査 4 本横断で「ドリルダウン型ゴール体験」は最も支持の厚い方向だった:

- Comment 1 Solanto: "If you're having trouble getting started, then the first step is too big"
- Comment 2 小鳥遊「タスク → 手順 → 締切」/ Barkley "Break It Down and Make It Matter" / Davis "First steps" / McCabe "Plan backward"
- Comment 3: Quest Log (WoW) の階層化、Khan Academy のツリー構造
- Comment 4: Khan Academy / Brilliant の知識ツリー、フローの「明確な目標」要件

既存 ADR-0017 (AI 分解非同期) / ADR-0049 (children count limit 撤廃) / ADR-0053 (decompose child estimate honesty) で AI 分解の技術基盤は整っている。本 ADR はその上に schema と粒度を載せる。

## Decision

AI 分解の出力 schema と粒度を以下に確定する:

1. **目標粒度: 30〜90 分レンジを推奨目安** (1 時間中心)。**強制ではない** — 5 分や 3 時間も許容、ユーザー調整 OK
2. 各子タスクには **完了条件 (Goal / Done / First step)** を AI が言語化する (具体項目数 / 必須 vs 任意 / 競合解決などの schema 詳細は M-β 設計時に確定)
3. 親タスクの達成度を子の積み上げで **可視化** する (ParallelogramProgress 系の延長、ADR-0055)
4. AI 分解の発動は **timer 文脈外** (タスク作成時 = ADR-0064 / タスク詳細画面 / 朝の棚卸し = ADR-0062) でのみ起きる (timer 中の介入は ADR-0058 で禁止)

## Consequences

### 肯定的影響

- 「1 時間でゴールに到達できる」という心理的な完結単位を毎タスクに作る。差別化軸 (ADR-0057) の表層体験を直接実装する
- 完了条件 (Goal / Done / First step) が常に明文化されるので、ADHD 文脈の "first step is too big" (Solanto) を予防できる
- ADR-0017 (非同期) / ADR-0049 (children count 撤廃) / ADR-0053 (estimate honesty) を変更せず、その上に schema を追加する形で実装可能 (既存投資保全)
- ADR-0064 タスク作成テンプレと schema が揃うので、作成 → 着手 → 振り返り の体験が一貫性を保つ

### 否定的影響・トレードオフ

- AI 分解の prompt 長が増える (Goal / Done / First step を生成する分)。コストは増えるが、レイテンシは ADR-0017 で非同期化済みなので UX 影響は小さい
- 「1 時間粒度」が user の好みと合わないケースで違和感が出る可能性。推奨目安 (強制でない) としているので user 編集で吸収するが、初期体感は要観察
- 親進捗可視化 (ParallelogramProgress) を子タスク数の変動 (ADR-0049 で上限撤廃済) と整合させる必要 (ADR-0055 wrap で部分的に対応済み)

## Alternatives considered

- **強制制 (1h レンジ外を許容しない)**: ユーザー特性 (3) が「合わない時間帯ですべきタスク」を強制されるリスク。Autonomy も損なう。不採用
- **単なる目安 (時間粒度を指定しない)**: 差別化軸 (ADR-0057) が抽象的になり、Motion との対比が弱まる。不採用
- **完了条件は user 入力のみ (AI 補完しない)**: ADR-0064 (タスク作成 title 必須のみ) と矛盾する。AI 補完が「サクッと放り込める」体験の核。不採用
- **発火シグナル方式 (dwell time / 着手不能シグナル検出時に AI 分解 proposal を timer 中に出す)**: ADR-0058 で「timer 中の AI 介入禁止」を確定したため、本 ADR では採用しない。timer 文脈外 (タスク作成 / 詳細 / 朝の棚卸し) で十分機能する

## Notes

- 完了条件 schema の詳細 (項目数 / 必須・任意 / 補完タイミング / ユーザー手動入力との競合解決) は M-β 設計時に確定する。本 ADR では「Goal / Done / First step を AI が言語化する」「目標は 30-90 分推奨」までを決める → 完了条件 schema の **項目** は [ADR-0066](./0066-decompose-completion-criteria-deliverable-done-first-step.md) で確定 (Goal は廃止し `deliverable` に置換)。補完タイミング / 競合解決は引き続き #244 の論点。
- ADR-0017 の race condition (親 active 化中に分解結果到着) は本 ADR で AI 分解を timer 文脈外に限定したため発生しない (timer 中は分解が走らない)
- 将来見直す条件: dogfooding で「1h 推奨」が user の作業リズムに合わないことが繰り返し観測されたら推奨レンジを再調整
