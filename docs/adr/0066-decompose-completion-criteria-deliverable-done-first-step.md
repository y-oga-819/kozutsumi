# ADR 0066: AI 分解の子タスク完了条件 schema を deliverable / done / first_step に確定する

- **Status**: Accepted
- **Date**: 2026-05-16
- **Related**: `docs/design/vision.md` / [Issue #243](https://github.com/y-oga-819/kozutsumi/issues/243) / [Issue #244](https://github.com/y-oga-819/kozutsumi/issues/244) / [Issue #246](https://github.com/y-oga-819/kozutsumi/issues/246) / [ADR-0061](./0061-ai-decomposition-one-hour-target-and-done-condition-schema.md) / [ADR-0057](./0057-redefine-moat-as-goal-driven-ai-decomposition.md) / [ADR-0064](./0064-task-creation-title-only-with-ai-template-fill.md)

## Context

ADR-0061 は「各子タスクに完了条件 (Goal / Done / First step) を AI が言語化する」と決め、Notes で「項目数 / 必須・任意 / 補完タイミング / 競合解決などの schema 詳細は M-β 設計時に確定する」と明示的に後続へ委譲した。本 ADR はそのうち **完了条件 schema の項目** を確定する (Issue #244)。

#243 (AI 分解 prompt の 1h 粒度 + 完了条件出力への更新) を実装する過程で、ADR-0061 の "Goal" が分解 AI の出力として成立しないことが判明した:

- ADR-0061 は Goal の根拠に Barkley "Break It Down and **Make It Matter**" (意味・動機) と、フロー理論の「明確な目標」要件の 2 つを引いていたが、両者を "Goal" の一語に畳んだまま schema を確定していなかった。
- 分解 AI が持つ入力は親タスクの title / body / 見積もり / サイズだけで、「なぜそのタスクをやるか」というユーザー固有のコンテキストを持たない。Barkley 読みの Goal (意味) を生成させると、title の言い換えか、もっともらしいだけの捏造した動機にしかならない。
- 一方 done / first_step は元から AI 分解出力として成立していた。タスク内容から観測可能に導けるためである (done = 完了判定条件、first_step = 着手の一手)。

つまり ADR-0061 の "Goal" は「フロー読み (明確な目標)」と「Barkley 読み (意味づけ)」が未分離のまま放置されていた。

## Decision

AI 分解が各子タスクに言語化する完了条件 schema を、以下の 3 項目に確定する:

1. **`deliverable`** — そのタスクが生む成果物 (名詞)。「時間を使った」ではなく「何が出来上がったか」を書く。状態変化タスクなら「〜された状態」。
2. **`done`** — `deliverable` が完成したと言える観測可能な条件。「だいたい出来た」のような曖昧な状態は不可。
3. **`first_step`** — 着手してまず手を動かす最初の一手。着手障壁にならない小ささにする。

付随して:

- ADR-0061 の "Goal" は廃止する。意味・動機づけ (Barkley "Make It Matter") は分解 AI の出力ではなく、**親タスク / ユーザー入力 / 行動データ蓄積 (ADR-0057 深層)** が担う。「子は親のゴールに向かう deliverable を積む」という構造になり、ADR-0057 のゴール駆動とも整合する。
- 3 項目は **フェイルソフト**。AI が言語化できなければ空文字を許容し、子タスクの生成自体は止めない (必須にしない)。
- 完了条件は task body への markdown 埋め込みではなく **構造化して保持** する (#247 親進捗可視化 / #245 AI 後追い補完が field 単位でアクセスするため)。物理表現 (カラム追加 or `completion_criteria` JSONB) は #246 の実装判断とする。

## Consequences

### 肯定的影響

- 3 項目すべてが分解 AI の入力 (タスク内容) だけから書ける。捏造する欄が無くなり、出力品質が安定する。
- `deliverable` が「何を残すか」を強制するため、「把握する」「確認する」のような成果物の曖昧なタスクが締まる。vision「何を仕上げれば done か曖昧だと freeze」への直接処方になる。
- done / first_step / deliverable が別軸 (いつ完了か / どう始めるか / 何を生むか) なので、title との役割の被りが無い。
- 構造化保持により #247 (親進捗) が deliverable 達成の積み上げを、#245 (後追い補完) が未補完の検出を、prose パースなしで行える。

### 否定的影響・トレードオフ

- `deliverable` と `done` は密結合する (done = deliverable + 品質バー)。論理的には done が deliverable を内包しうるが、進捗ナラティブの単位 / 行動シグナルとして deliverable を独立に持つ価値を優先し、3 項目を維持する。
- ADR-0061 が掲げた「意味づけ (Make It Matter)」は本 ADR の AI 分解出力からは外れる。意味の供給は親レベル / 深層に委ねるため、その経路が育つまで意味づけ体験は弱い。
- ADR-0061 Decision 2 の項目名 (Goal / Done / First step) を変更するため、ADR-0061 を読む際は本 ADR との併読が必要になる (ADR-0061 Notes にポインタを追記して緩和)。

## Alternatives considered

- **Goal を「意味・動機」のまま AI に生成させる**: 分解 AI はユーザーコンテキストを持たないため捏造になる。不採用。
- **Goal を「明確な目標」読みで残す**: フロー理論の「明確な目標」は AI 生成可能だが、自立した title (ADR-0016) + done がほぼカバーし、独立した価値が無い。不採用。
- **完了条件を done + first_step の 2 項目に統合**: done が deliverable を内包するため成立はする。しかし deliverable を独立に持つことで親進捗のナラティブ単位 / 行動データのシグナルが素直になるため、3 項目を採る。
- **完了条件を task body に markdown 埋め込みで保持**: migration 不要・render 1 経路の利点はあるが、#247 / #245 が field 単位アクセスを必要とし、prose パースが脆い。不採用。

## Notes

- 本 ADR は ADR-0061 Notes が M-β に委譲した schema 詳細のうち **項目** を確定するもの。**補完タイミング** (作成直後 / 詳細閲覧時 / 朝の棚卸し) と **ユーザー手動入力と AI 補完値の競合解決ルール** は Issue #244 に残る論点であり、#245 (AI 後追い補完) の設計時に別途確定する。
- 実装への反映: #243 で先行実装した `goal` フィールドを `deliverable` に置換する (prompt / parser)。DB schema は #246。
- 将来見直す条件: dogfooding で `deliverable` と `done` の書き分けが安定せず、ユーザーがどちらか一方しか埋めない傾向が続いたら 2 項目統合を再検討する。
