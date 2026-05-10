<!--
書き終えたらセルフチェック（運用ルールは `.claude/skills/kozutsumi-adr/SKILL.md`）:
- [x] この ADR 1 枚を Deprecated にした時、他の判断はクリーンに残るか
- [x] 判断以外（パラメータ・閾値・実装詳細）が混ざっていないか
- [x] 依存する他の ADR を Related に書いたか
- [x] Status / Date を埋めたか
-->

# ADR 0058: スタックの並び順は user 100% 所有、AI は補助 UI までで stack_order に介入しない

- **Status**: Proposed
- **Date**: 2026-05-10
- **Related**: `docs/design/architecture.md` §1.6 §1.8 / [ADR-0003](./0003-event-driven-stack-as-core.md) / [ADR-0013](./0013-ai-as-augmentation-only.md) / [ADR-0057](./0057-experience-anchor-three-verbs-and-stack-top-timer.md) / Issue #234

## Context

Issue #234 のリサーチで kozutsumi の差別化軸は「行動データの深さ」であると同時に「user の judgment を奪わない設計」であることが再確認された。Sunsama / Motion との差は機能の有無ではなく、**user の主体性を保持したまま AI が学習する**経路を設計できるかにある。

`docs/design/architecture.md` §1.8 では「スコアリング × LLM」で AI が並び替えを提案する構造が示唆されているが、その提案がそのまま `stack_order` を書き換える経路と、補助 UI として user の判断を経由する経路の区別が明示されていなかった。AI が直接 stack を書き換える経路を許すと次の問題が起きる:

1. **行動データの汚染**: stack 順が user の意図と AI の介入の混合になり、「user は何を優先しているか」の信号が AI 介入で歪む
2. **責任の曖昧化**: 「上に積んだのは自分か AI か」が不明になり、stop / 先送りが起きたときに「AI のせいで上に来ていた」言い訳経路が生まれる。Wall of Awful の再生成
3. **prosthesis としての一貫性の喪失**: ADR-0057 の「3 動詞」と「stack top auto-bind」は「stack top は user の意志の写像」を前提にしている。AI 介入が混ざると前提が崩れる

ADR-0013 で「AI は augmentation only / core path は AI 失敗で止まらない」を確立しているが、本 ADR は **AI が成功した場合でも core path（stack 順）を直接書き換えない** という上位制約として独立に必要である。

## Decision

stack の並び順は **user の操作のみ** で変わる。AI は次の経路でのみ stack に関与する:

1. **学習・観測**: action_log / task テーブルから user の優先判断パターンを学習する。本 ADR の対象外（ADR-0054 で個別判断済み）
2. **補助 UI でサジェスト**: 「この task は下げては？」「これを次に？」のような提案を user に提示する。user の accept / reject を経由してのみ `stack_order` が変わる
3. **AI 自動分解で子 task を挿入する場合**（ADR-0017 系列）: 親 task の位置を起点とした挿入は user 操作の延長として扱う（user が「分解する」と決めた経路の派生）

AI が独自に並び替えを実行する経路は実装しない。`docs/design/architecture.md` §1.8 「スコアリング × LLM」は **補助 UI レイヤー** として再定義する。

## Consequences

### 肯定的影響

- stack 順の意味が clean に保たれる。「user が上に置いた = user が次にやりたいと判断した」が一意になり、行動データの解析根拠が崩れない
- ADR-0057 の不変条件（stack top = current task）が「user の意志の写像」として整合する
- prosthesis の一貫性が保たれる。「AI が裏で動かす」恐怖を user が抱かずに済み、長期信頼の積み上げが起きる
- AI 補助 UI の accept / reject 操作自体が新しい行動データになる（「AI のサジェストを user がどれだけ受け入れるか」が学習信号として独立）

### 否定的影響・トレードオフ

- AI が「明らかに最適な並び替え」を見つけても自動適用できない。user の操作 1 タップが間に挟まる
- 補助 UI の出し方を間違えると notification 疲れになる。サジェスト頻度・タイミングは別 ADR / 実装 issue で扱う
- Motion 類似の「全自動スケジューリング」を期待する user との体験ギャップが生まれる。これは vision の「行動データで差別化する」前提と整合するので受け入れる

## Alternatives considered

- **AI が直接 stack 順を書き換える（提案を経由しない）**: Motion 類似の体験で省力化される一方、上記 3 つの問題（データ汚染 / 責任曖昧化 / prosthesis 不整合）が同時に発生する。kozutsumi の差別化軸と矛盾するため不採用
- **AI 介入を opt-in で許可する**: user が ON にすれば AI が直接書き換える経路。柔軟だが、ON / OFF で行動データの意味が変わるため学習信号として扱いにくい。実験段階の機能にしては core 体験への影響が大きすぎる。不採用
- **「AI 介入レイヤー」を別 view（提案 view）として分離する**: stack view とは別の画面で AI が並べた候補を見せる。判断負荷は下がるが、user が補助 UI を見る習慣が育たないと機能しない。本 ADR では「stack view 内のサジェスト UI」を前提として進め、別 view 化は将来見直し条件とする

## Notes

- ADR-0017（AI 自動分解）と ADR-0060（分解 trigger を `task_size` で判定）は「user が `task_size=large` で task を作成した」操作の延長として stack を動かすため、本 ADR の「user の操作のみ」と整合する（user 起点の動作）
- 補助 UI のサジェスト粒度（task カード横のヒント / モーダル / 通知）は実装 issue で確定する。本 ADR は経路の境界線のみ固定する
- 将来見直す条件:
  - AI の精度が十分に高くなり、user が「自動適用してほしい」と明示的に opt-in する需要が強くなった
  - 補助 UI 経由のサジェスト accept 率が安定して高く、自動適用しても行動データが汚染されないと検証できた
  - kozutsumi の差別化軸自体が「行動データの深さ」から別の軸に移った
