# ADR 0045: `estimated_minutes` 不在時に `task_size` を主観ラベルとして添える

- **Status**: Accepted
- **Date**: 2026-05-04
- **Related**: [ADR-0026](./0026-estimation-correction-display-style.md) / [ADR-0038](./0038-task-size-enum.md) / [ADR-0036](./0036-simplify-task-registration-workflow.md) / [ADR-0024](./0024-estimation-correction-by-category-median.md) / Issue #182 / Issue #170 / PR #181

## Context

[ADR-0036](./0036-simplify-task-registration-workflow.md) と [ADR-0038](./0038-task-size-enum.md) で「主観サイズ (`task_size`)」と「AI 推定の `estimated_minutes`」を別軸で並存させる方針を確定した。これにより TaskForm は `task_size` のみを必須入力とし、`estimated_minutes` は AI 分解時にのみ入る経路になった (#170 / PR #181)。

その結果、**AI 分解が `skipped` / `failed` で親が残るケース** (= 短文単発タスク / AI が「分解不要」と判断したケース) では、親 task は `task_size` だけを持ち `estimated_minutes` は null になる。Stack View / 詳細パネルの見積もり表示は [ADR-0024](./0024-estimation-correction-by-category-median.md) 〜 [ADR-0026](./0026-estimation-correction-display-style.md) のラインで `estimated_minutes` を入力に動くため、**この経路で時間情報が UI から完全に消える** regression が入る (Issue #182)。

短文単発タスクは「ユーザーが登録して上から順にやる」default 経路 ([ADR-0036](./0036-simplify-task-registration-workflow.md)) の中核ケースであり、Stack でこのカードに時間情報がゼロだと「次に何分くらい使うか」の感触が掴めない。Phase 4 行動分析の素材としても、ユーザーが Stack 上で時間感を持って意思決定できることが前提になる。

[ADR-0038](./0038-task-size-enum.md) は「主観値を分単位の代表値に倒すのは限定的な場面のみ (例: TaskForm の初期値提示)」と明記しており、Stack View で安易に `TASK_SIZE_TO_MINUTES` で分換算するのは精神に反する。また `large` は代表分が null のため分換算戦略では `large` のときだけ表示が消える歪みも残る。

「`estimated_minutes` 不在 + `task_size` あり」のときに UI でどう見せるかを、[ADR-0026](./0026-estimation-correction-display-style.md) (補正対象数値の併記) とは別判断として確定する必要がある。

## Decision

`estimated_minutes` が null かつ `task_size` が non-null のとき、Stack View カード (Top / Row) と詳細パネルヘッダで **`task_size` の表示ラベル (`30分` / `半日` / `1日超` 等) を主観値として添える**。分単位への換算 (`TASK_SIZE_TO_MINUTES` 経由) は使わない。

- 視覚階層は `fg-faint` 相当 (= [ADR-0026](./0026-estimation-correction-display-style.md) で「補正なし」のときの元値表示と同じ階層)。補正対象の数値より一段控えめに置く
- `task_size` ラベルは `TASK_SIZE_LABELS` の和文 (例: `30分` / `半日` / `1日超`) をそのまま出す。「主観」「目安」等のラベルは付けない ([ADR-0026](./0026-estimation-correction-display-style.md) のラベル無し原則を継承)
- 詳細パネルのヘッダ自然文ライン (`あなたの見積もり N min ・ 同じ種類のタスクは平均 X 倍...`) は出さない (補正対象ではないため、自然文を出すと文意が破綻する)
- `estimated_minutes` も `task_size` も null のときは何も出さない (従来通り)

優先順は:

1. 補正適用ケース (`estimated_minutes` あり + 補正条件成立): 補正後 + 元値の併記 ([ADR-0026](./0026-estimation-correction-display-style.md))
2. 補正なしケース (`estimated_minutes` あり + 補正条件不成立): 元値のみ `fg-faint` ([ADR-0026](./0026-estimation-correction-display-style.md))
3. **本 ADR の対象** (`estimated_minutes` null + `task_size` あり): `task_size` ラベルを `fg-faint`
4. どちらも null: 何も出さない

## Consequences

### 肯定的影響

- 短文単発タスクの Stack カードで時間感が消える regression が解消する。default 経路 ([ADR-0036](./0036-simplify-task-registration-workflow.md)) の中核ケースを救える
- 主観値を分換算しないことで [ADR-0038](./0038-task-size-enum.md) の「主観と推定は別軸」の精神を UI 側でも貫ける。ラベル文言 (`30分` / `半日`) が分換算の数値と異なる文字種を持つため、ユーザーが「これは AI 推定ではなく自分が選んだ主観値」だと潜在的に区別できる
- `large` (代表分 null) も `1日超` ラベルでそのまま表示できる。分換算戦略にあった「large だけ表示が消える」歪みが出ない
- 補正対象の数値表示 ([ADR-0026](./0026-estimation-correction-display-style.md)) と表示位置・色階層を揃えるため、実装の差分は小さい (CorrectedEstimate 相当の helper を 1 枚足す程度)

### 否定的影響・トレードオフ

- Stack View 内に「分単位の数値」と「主観ラベル文字列」が混在する。`30min` (補正後) と `30分` (主観) のような近接表示が起きうるが、フォント・色・文字種で階層が出るので区別はつく想定
- 主観ラベルは補正の対象ではないので、ユーザーから見ると「AI が補正していない時間表示」が混じる体験になる。ただし [ADR-0026](./0026-estimation-correction-display-style.md) の「補正の存在を明言しない」原則により、ユーザーが意識的に補正の有無を見ることはない
- `task_size` を後から `estimated_minutes` に昇格させる (= AI 推定が後追いで入る) パスは現状の AI 分解では発生しない。将来 [Issue #173](https://github.com/y-oga-819/kozutsumi/issues/173) (秘書からの相談 mode) 等で「主観値を AI が時間値に翻訳する」経路が入る場合、本 ADR の判断と再整合が必要になる

## Alternatives considered

- **案 A (採用): `task_size` ラベルを主観値として添える** — 上記 Decision
- **案 B: `TASK_SIZE_TO_MINUTES[size]` で分に倒して `fmtDuration` で表示** — Stack 表示が分単位に統一される利点はあるが、(1) [ADR-0038](./0038-task-size-enum.md) の「主観を分換算するのは限定的場面のみ」の精神に反する、(2) 主観値と補正後数値が同じ文字種 (`30分`) で並び区別不能になる、(3) `large` は代表分 null のため `large` だけ表示が消える歪みが残る。**不採用**
- **案 C: 何も出さない (現状維持)** — regression を維持する選択。default 経路の中核ケースで時間感が消える体験悪化を許容することになり、[ADR-0036](./0036-simplify-task-registration-workflow.md) のシンプル化方針と矛盾する。**不採用**
- **案 D: TaskForm submit 時に `task_size` を `estimated_minutes` に倒して書き込む** — [ADR-0038](./0038-task-size-enum.md) で明示的に棄却済み (主観と推定が同じ列に混ざり Phase 4 行動分析が分離不能になる)。本 ADR の対象範囲ではない

## Notes

- ラベル文言の決定は [ADR-0038](./0038-task-size-enum.md) Notes で「`large` の表示文言は実装で詰める」とされていた箇所が `TASK_SIZE_LABELS` (= `1日超`) として既に確定している。本 ADR でその選定をやり直しはしない
- 補正後数値との視覚階層 (フォントサイズ・色) の具体トークンは実装の関心であり、本 ADR の supersede ではない
- 本 ADR を supersede する trigger:
  - 主観値も補正エンジン ([ADR-0024](./0024-estimation-correction-by-category-median.md)) の入力に取り込む方針に変える
  - 主観値を分換算して `estimated_minutes` に倒す方針に変える ([ADR-0038](./0038-task-size-enum.md) の supersede と一体)
  - 「補正の存在を明言しない」原則 ([ADR-0026](./0026-estimation-correction-display-style.md)) を覆す
- dogfooding 観察項目: 主観ラベルと補正後数値が並んだときに「AI 推定じゃない」と読み取れるか、ラベル文字列の存在感が強すぎないか。観察結果次第で、装飾 (色トーンの細分化 / 「主観」プレフィックス) を別 issue で詰める余地を残す
