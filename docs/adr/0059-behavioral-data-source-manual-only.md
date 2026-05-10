<!--
書き終えたらセルフチェック（運用ルールは `.claude/skills/kozutsumi-adr/SKILL.md`）:
- [x] この ADR 1 枚を Deprecated にした時、他の判断はクリーンに残るか
- [x] 判断以外（パラメータ・閾値・実装詳細）が混ざっていないか
- [x] 依存する他の ADR を Related に書いたか
- [x] Status / Date を埋めたか
-->

# ADR 0059: 行動データの source は手動操作のみ。passive 観測 / ESM サンプリングは採用しない

- **Status**: Proposed
- **Date**: 2026-05-10
- **Related**: `docs/design/vision.md` / [ADR-0001](./0001-action-logs-from-phase1.md) / [ADR-0035](./0035-action-log-payload-schema-and-actor-type.md) / [ADR-0054](./0054-behavioral-evaluation-signals-derive-from-existing-action-log.md) / Issue #234

## Context

Issue #234 のリサーチで「行動データを取る経路」として次の 3 種類が候補に挙がった:

1. **手動操作経路**: user が操作した結果（task CRUD / timer start・stop・complete / AI 分解 trigger / Calendar 連動）を action_log に書く。kozutsumi が ADR-0001 / ADR-0035 で採用してきた経路
2. **passive 観測**: OS / browser hook で「アクティブなアプリ」「キーストローク頻度」「画面の前にいるか」等を取得し、user の集中度・離脱を推定する
3. **ESM (Experience Sampling Method)**: ランダムなタイミングで「今何をしている？」「集中度は？」を user に問うアンケート経路

passive 観測と ESM は学術研究では「真の集中状態」「未報告の中断」を捕捉する強力な手段だが、kozutsumi の体験設計（vision「育てている自覚を持たせない」/ ADR-0057「3 動詞 / 判断点の最小化」）との整合性で重大な懸念がある:

1. **passive 観測の侵襲性**: OS hook / browser extension は permission の説明コストが高く、prosthesis の「気づいたら使っている」体験と矛盾する。user が「監視されている」感覚を持つ瞬間に長期使用が崩れる
2. **ESM の判断点増加**: ランダムに割り込む question は Wall of Awful を強化する。kozutsumi の差別化軸（user judgment を奪わない）と直接矛盾
3. **データの質と量のトレードオフ**: passive 観測は「ノイズの多い大量データ」を生み、ESM は「純度の高い少量データ」を生む。両者とも分析戦略が複雑化し、kozutsumi の「shipped 体験から行動データを取る」シンプルさを損なう

ADR-0054 で「行動評価信号は既存 action_log から導出する（新規 event 追加なし）」を確立した。本 ADR はその上位の方針として「**そもそも行動データの source を手動操作に限定する**」を独立 ADR として固定する。

## Decision

行動データの source は **手動操作のみ** とする。具体的には:

1. **採用する source**: user の手動操作（task CRUD / timer の start・stop・complete / AI 分解 trigger / Calendar event との連動 auto-stop / quick-button 操作 等）の結果を action_log に記録する
2. **採用しない source**: OS / browser の passive 観測、ESM サンプリング、画面共有 / カメラ等の生体信号
3. **system actor 経路は許可**（ADR-0035）: system が起こした自動操作（例: Calendar event 開始時の timer auto-stop）は `actor_type='system'` で記録し、user 操作と区別する。ただしこれは user の判断を経た trigger（Calendar 連動を有効化したのは user）の派生であり、passive 観測ではない

「行動データの深さ」（vision の差別化軸）は手動操作データの解析の深さで実現する。データ source の幅では実現しない。

## Consequences

### 肯定的影響

- prosthesis の一貫性が保たれる。「kozutsumi はアプリ内の操作だけ見ている」が user の理解として安定し、長期信頼が積み上がる
- permission モデルが単純（DB 書き込みのみ、OS hook なし）。インストール体験 / プライバシー説明コストが極小
- データ解析の戦略が一貫する。ADR-0054 の「既存 action_log から導出」と一気通貫で噛み合う
- vision「育てている自覚を持たせない」と整合する。判断点を増やさず、user が知らないうちに信号が貯まる経路を維持

### 否定的影響・トレードオフ

- **「未操作の時間」が見えない**: user が PC の前にいながら kozutsumi を触っていない時間（他アプリで作業 / SNS 閲覧 / 離席）を区別できない。タスクの真の所要時間と user 報告の所要時間に乖離が出ても捕捉できない
- **「集中の質」が見えない**: 同じ「task_started → task_completed」でも、深い集中だったか何度も中断されたかを passive 観測なしでは推定できない。stop の頻度から間接的に推定するに留まる
- **ESM の心理学的な高解像度データを捨てる**: 「今この瞬間の感情・集中度」のような subjective state は手動操作からは取れない。Phase 4 以降のスコアリングで「客観行動 + 主観状態」のハイブリッドが必要になった場合に再検討が必要

## Alternatives considered

- **passive 観測を opt-in で導入**: user が許可すれば OS hook を有効化する経路。柔軟だが「監視されている」体験を user が一度でも持つと信頼が崩れる。opt-in の説明コスト自体が prosthesis 体験と矛盾。不採用
- **ESM を「stop 時にだけ理由を聞く」形で軽量導入**: user の中断瞬間にだけ subjective signal を取る案。ADR-0057 で `PauseReasonModal` 廃止を決めた経路と直接矛盾する（判断点を増やす）。不採用
- **手動操作 + 「明示的な subjective input」UI を用意**: user が任意で「今の集中度」をつける UI。user が能動的につけたい時だけ書く形なら判断点を増やさない一方、データ量が極小になり学習信号として弱い。本 ADR の境界外（将来 user が明示的に欲しがれば追加検討）として保留

## Notes

- 本 ADR は「**source の境界**」を固定する。その境界の中でどの event を action_log に書くかは ADR-0001 / ADR-0035 / ADR-0054 が個別に確定する
- ADR-0058（stack 順は user 所有）と本 ADR は独立: 前者は AI の出力経路、後者は AI への入力経路を制限する。両者が揃って prosthesis の一貫性が成立する
- 将来見直す条件:
  - 手動操作データだけでは Phase 4 のスコアリング / 提案精度が頭打ちになり、subjective state なしでは差別化が崩れると検証された
  - passive 観測の OS-level プライバシー保護が技術的に進化し、「監視感」を生まない実装が標準化された
  - kozutsumi が個人特化から外れ（多人数チーム向け等）、行動データの集約が個人 prosthesis 文脈を離れた
