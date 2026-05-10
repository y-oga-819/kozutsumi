# ADR 0063: 過集中は介入しない (強制中断 anti-pattern の明文化)

- **Status**: Accepted
- **Date**: 2026-05-10
- **Related**: [Issue #234](https://github.com/y-oga-819/kozutsumi/issues/234) / [ADR-0058](./0058-timer-three-verbs-and-no-ai-interruption.md) / [ADR-0062](./0062-morning-review-ritual-fifteen-minutes.md)

## Context

想定ユーザーの行動特性 (#234) のうち (1) 過集中で時間を忘れる、への対処方針として、調査 4 本横断で次のように対立する見解が示された:

- Comment 1 Mahan: Wall of Awful 状態に強制中断は freeze→fight/flight を誘発、Heart 系は最も非倫理的
- Comment 2 DASHI 半熟ポモドーロ: 「乗っていても止める」原則を支持 (過集中の燃費悪化対策)
- Comment 3: Things 3 / Bear の Quiet Productivity が長期継続率を静かに高める
- Comment 4 SDT: Autonomy 剥奪は外的報酬で内発を crowd out する

想定ユーザーは「過集中はそのままパフォーマンスが出ているなら続けたい」立場 (#234 議論)。Hallowell VAST「right kind of difficult」も「変動の山を意図的に活用する」を支持する。

ADR-0058 の「timer 中 AI 介入禁止」原則を、過集中という具体的な場面でも徹底する必要がある。

## Decision

過集中 (long-running active session) に対して **AI 側からの能動的介入は一切しない**:

- 半熟ポモドーロ的な「乗っていても止める」soft nudge は採用しない
- 非アクティブ検知による auto-pause も default では入れない (opt-in 余地は残す = Open Question)
- 強制中断 (Heart 系 / Streak 系 / 強制 Pomodoro 通知) は禁止

## Consequences

### 肯定的影響

- 想定ユーザー特性 (1) 過集中で時間を忘れる、を肯定し、Hallowell VAST「right kind of difficult」と整合する
- ADR-0058 の「timer 中 AI 黙る」原則と完全に整合する (例外を作らない一貫性)
- 過集中で得られる成果 (高難度タスクの一気通貫) を最大化できる
- Streak / Heart 系の罰デザインを構造的に避けられる (ADR-0058 と同じく)

### 否定的影響・トレードオフ

- stop し忘れて翌朝まで timer が回り続けるケースが起きうる → ADR-0062 朝の棚卸しでの事後補正で対処
- 「過集中の燃費悪化」(Comment 2 半熟ポモドーロが指摘) を放置する。長期的に消耗が増える可能性
- per-task 計測のノイズが増える可能性 (実作業時間と zone time の区別が必要 = ADR-0062 で扱う)

## Alternatives considered

- **半熟ポモドーロ (15 分 / 25 分タイマーで強制 nudge)**: 強制中断の Autonomy 剥奪コストの方が、過集中の燃費悪化コストより大きいと判断。ADR-0058 の原則とも矛盾。不採用
- **非アクティブ検知 auto-pause を default ON**: 「黙って 30 分で止められた」体感が ADR-0058 の原則と矛盾。「能動介入しない」ためには user が認識した上で opt-in する必要がある (本 ADR では default OFF とし、opt-in 提供有無は dogfooding 後に判断)
- **Whoop 型 Strain Coach (累積負荷を提示するが判断は user)**: 提示自体が timer 中に出るので ADR-0058 と矛盾。同様の機能は朝の棚卸し (ADR-0062) で代替可能。不採用

## Notes

- auto-pause を opt-in で用意するか / 用意しないかは Open Question。M-α 期間の dogfooding で判断
- 関連: ADR-0058 (timer 中 AI 黙る) / ADR-0062 (朝の棚卸しで事後補正)
- 将来見直す条件: dogfooding で「過集中の燃費悪化」が継続利用に支障を出す程度で観測されたら、opt-in での soft nudge を再検討
