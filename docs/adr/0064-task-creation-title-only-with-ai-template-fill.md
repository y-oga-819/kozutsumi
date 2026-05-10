# ADR 0064: タスク作成は title 必須のみ + AI が後追いで完了条件を補完する

- **Status**: Accepted
- **Date**: 2026-05-10
- **Related**: [Issue #234](https://github.com/y-oga-819/kozutsumi/issues/234) / [ADR-0036](./0036-simplify-task-registration-workflow.md) / [ADR-0037](./0037-task-form-single-entry-with-body.md) / [ADR-0058](./0058-timer-three-verbs-and-no-ai-interruption.md) / [ADR-0061](./0061-ai-decomposition-one-hour-target-and-done-condition-schema.md)

## Context

「タスク管理が目的になると面倒になって続かない」を構造的に避ける必要がある。調査 2 本横断で次の処方が示された:

- Comment 2 借金玉「自分を変えるな、道具に頼れ」/ Davis "morally neutral" — フォーマット負荷を AI に投げる
- Comment 2 小鳥遊「タスク → 手順 → 締切」 — 手順分解は構造化されるべきだが、user が毎回書くのは続かない

既存 ADR-0036 (TaskForm 単一入口) / ADR-0037 (body 欄) で title + body の単一入力にすでに簡素化済みだが、`body` は自由記述で構造を持たない。一方、ADR-0061 で AI 分解の出力 schema (Goal / Done / First step) を確定したため、これと同じ schema をタスク作成側にも適用すれば、warmup フェーズなしで「いつ見ても goal-clarity が揃っている」状態を作れる。

ADR-0058 で timer 中の AI 介入を禁止したため、AI 補完は timer 文脈外で発動する必要がある。

## Decision

タスク作成の入力要件と AI 補完を以下に確定する:

1. **必須入力は title のみ**
2. **メモ書き (`body`) は推奨**。思考のタネを軽く投入する欄として ADR-0037 の `body` をそのまま再解釈して活用
3. **残りの schema (Goal / Done / First step / Risk 等) は AI が後追いで補完する**
   - 補完タイミングは **timer 文脈外** (タスク詳細画面の閲覧時 / 朝の棚卸し)
   - title + メモ書きを起点に、AI が schema を埋める
4. 補完される schema は ADR-0061 の AI 分解出力 schema と一致させる

## Consequences

### 肯定的影響

- 思いついた瞬間に title だけで stack に投入できる (所要時間数秒)。「サクッと放り込める」体験が体験の最優先軸として確立する
- AI 補完 schema が ADR-0061 の AI 分解 schema と一致するので、タスク作成 → 着手 → 振り返り の体験が schema 一貫性を保つ
- ADR-0036 / 0037 をそのまま活用できる (`body` 欄をメモ書き欄として再解釈するだけ)。マイグレーションコストが小さい
- AI が裏で動く前提が vision「気づいたら細かくなってる」と整合する

### 否定的影響・トレードオフ

- AI 補完値とユーザー手動入力の競合解決を別途設計する必要がある (ユーザーが手動で書いた値と AI 補完値の優先順位、上書きルール)
- AI 補完がいつ走るかで体感が変わる (作成直後 / 詳細閲覧時 / 朝の棚卸し)。詳細は M-β 設計時に確定
- title + メモ書きが極端に短い場合、AI 補完精度が低くなる可能性がある

## Alternatives considered

- **必須項目を増やす (Goal / Done / First step を必須入力)**: 「サクッと放り込めない」体験になり、タスク管理が目的化する。借金玉 / Davis の処方に反する。不採用
- **AI 補完を default オフ (user が明示的に呼ぶ)**: 「AI が裏で動く」前提が vision「気づいたら細かくなってる」と整合する。明示呼び出しは opt-in としては残し得るが default ではない。不採用
- **メモ書きも必須化**: title のみの軽量投入を許容しないと、思いつきの捕捉が弱まる。不採用

## Notes

- schema 詳細 (項目数 / 必須・任意の境界 / 補完タイミング / ユーザー手動入力との競合解決) は M-β 設計時に確定する。本 ADR では「title 必須 / メモ書き推奨 / 残りは AI 補完」までを決める
- ADR-0036 / 0037 (TaskForm 単一入口 + body 欄) は本 ADR で supersede されない。本 ADR は ADR-0036 / 0037 の `body` を「メモ書き欄」として再解釈する形で延長する
- 将来見直す条件: dogfooding で「title だけだと AI 補完精度が低すぎる」が観測されたら、推奨項目をより明確にガイドする UX を再検討
