# ADR 0058: timer UX は 3 動詞 (start / stop / complete) + stack top auto-bind + timer 中の AI 介入禁止

- **Status**: Accepted
- **Date**: 2026-05-10
- **Related**: `docs/design/architecture.md` §1.3 / §1.4 / §2.3 / [Issue #234](https://github.com/y-oga-819/kozutsumi/issues/234) / [ADR-0003](./0003-event-driven-stack-as-core.md) / [ADR-0004](./0004-time-entry-state-machine.md) / [ADR-0017](./0017-ai-task-decomposition-async.md) / [ADR-0057](./0057-redefine-moat-as-goal-driven-ai-decomposition.md) / [ADR-0061](./0061-ai-decomposition-one-hour-target-and-done-condition-schema.md) / [ADR-0064](./0064-task-creation-title-only-with-ai-template-fill.md)

## Context

想定ユーザーの行動特性 (#234) のうち (1) 過集中で時間を忘れる、(4) 強制的な時間制限で集中が切れる、と現 vision の中核機構「タイマー駆動 active-paused state machine」(architecture §2.3) が衝突する。調査 4 本横断で次の知見が示された:

- Comment 1 (Mahan): Wall of Awful 状態に強制開始は freeze→fight/flight 反応を誘発
- Comment 3: Duolingo Heart 型の強制中断は最も非倫理的、Things 3 / Bear の Quiet Productivity が ADHD 層で長期継続率を静かに高める
- Comment 4 (SDT): Motion 型の自動スケジューリングや能動介入は Autonomy を奪い、外的報酬で内発を crowd out する

加えて vision「気づいたら AI が賢くなってた」は「能動的に AI を呼ぶ UX」と矛盾する。既存 ADR-0003 (event-driven stack as core) / ADR-0004 (time-entry state machine) / ADR-0017 (AI 分解非同期) は維持しつつ、timer UX を簡素化する原則を確定する必要がある。

## Decision

timer UX の原則を以下に統一する:

1. ユーザーが触る動詞は **start / stop / complete の 3 つだけ** (1-tap interrupt は ADR-0059 で別途扱う)
2. **stack top が timer の current task として自動 bind** される。「次に何をやるか」を選ぶ操作はゼロ
3. **timer 動作中 (start ~ stop) には AI が能動的に介入しない**。warmup フェーズ・モーダル・選択肢を一切出さない
4. AI による分解 / テンプレ補完 / 提案は **timer 文脈外** (タスク作成時 / タスク詳細画面 / 朝の棚卸し) でのみ発動 (具体は ADR-0061 / ADR-0062 / ADR-0064)

## Consequences

### 肯定的影響

- 摩擦最小化で着手ハードルが下がる (Davis "Permission to start")
- Wall of Awful 状態に強制介入が起きないので fight/flight 反応を誘発しない
- Streak / Heart 系の罰デザインを構造的に避けられる
- ADR-0017 (AI 分解非同期 / status pill 表示) と整合する (timer 中の status pill は引き続き許容、能動提案だけ禁止)

### 否定的影響・トレードオフ

- 「AI 秘書が常に並走している」という能動的な体感は出にくい。これは ADR-0061 (AI 分解粒度) と ADR-0062 (朝の棚卸し) で補う設計
- ユーザーが「行きたくないタスク」が stack top に居座って start を押せない時、システム側の能動的救済手段がない。stack 並び替えで別タスクを top にして start すれば事実上の push back と同等という設計で対処
- 過集中で stop し忘れて長時間記録が残るケースが起きうる。ADR-0062 朝の棚卸しでの事後補正で対処 (ADR-0063 と一体)

## Alternatives considered

- **post-start warmup フェーズ (start 押下後の 1 分で AI brief 表示 + 「続ける / 分解 / push back」の 3 択)**: 「ユーザーが触るのは timer だけ」原則を裏切る。操作が複雑化すると使う気がなくなる。AI brief 自体は ADR-0061 / ADR-0064 のタスク作成時 / 詳細画面 / 朝の棚卸しで見られるので、timer 中に出す必要がない。不採用
- **pre-start size 警告 (size ≥ 90 min なら start 前に分解 offer)**: timer 開始前のフリクション増。サイズ情報は stack top に静的に表示するだけで十分、能動 offer は ADR-0061 / ADR-0064 の timer 文脈外で行う。不採用
- **「dwell time → AI 分解 proposal 発火」シグナル設計**: ユーザーは start 前に詰まるのではなく、start 後にゴール理解で詰まるパターンが多い。timer 文脈外のテンプレ補完 (ADR-0064) で処方する方が筋が良い。不採用

## Notes

- 「重いから後でやる」は stop で paused にすれば事実上の push back と同等。stack 並び替えで別タスクを top にして再 start する
- architecture §1.3 「優先度主導のスタック」の「分断着手 / 分解挿入」は本 ADR で「分解は timer 文脈外で」に整理される (architecture.md の更新は本軌道修正 ADR 群が確定後に別途)
- 将来見直す条件: dogfooding で「3 動詞では不足、追加動詞が必要」なケースが繰り返し観測されたら再考
