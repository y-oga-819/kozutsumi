# ADR 0053: AI 分解の子見積もりから縮小バイアスを除去する (cap 削除 + estimated_minutes を size gate 化)

- **Status**: Accepted
- **Date**: 2026-05-06
- **Related**: [ADR-0017](./0017-ai-task-decomposition-async.md) / [ADR-0024](./0024-estimation-correction-by-category-median.md) / [ADR-0026](./0026-estimation-correction-display-style.md) / [ADR-0038](./0038-task-size-enum.md) / [ADR-0045](./0045-subjective-size-display-without-estimated-minutes.md) / [ADR-0049](./0049-remove-ai-decompose-children-count-limit.md)

## Context

`src/shared/ai/prompts/decompose.ts` の AI 分解 prompt は、子タスクの見積もりに対して **二重の縮小バイアス** を持っていた。

1. **親 `task_size` cap**: 「親の `task_size` より大きい値を子に付けない」と明示している。親が `large` の場合は子の上限が `large` (= 等価) になるが、AI は「親より小さく」と読みやすく、`4h` 未満に押し込む傾向が出る。
2. **`estimated_minutes` バケット最大 120 への暗黙クリップ**: バケット最大が 120 (= 2h) で、prompt の null 条件は「自信が無ければ null」(= 確信度ゲート)。AI は「2h を確実に超える」と判断していても、最大バケット `120` をそのまま選ぶ。「2h でも `120 minutes` でもないタスク」が「2h」と表示される。

この二重の縮小バイアスが顕在化するケースを 2 通りの LLM (ChatGPT / Claude) で実測した:

- 親タスク = 「組織の 5 ヵ年計画を策定する」(`task_size: large`)
- ChatGPT 出力: 全 11 子の `estimated_minutes` が ≤120、`task_size` が ≤2h。実態は数日〜数週間規模の子も `120 minutes` にクリップされた
- Claude 出力: 13/15 子が ≤120、2 子だけ `null + 4h` で正しく振る舞った

UI ([CorrectedEstimate](../../src/features/task-stack/CorrectedEstimate.tsx)) は [ADR-0045](./0045-subjective-size-display-without-estimated-minutes.md) により `estimated_minutes === null` のときだけ `task_size` ラベル (例: `半日` / `1日超`) に fallback する。AI が嘘の `120 minutes` を返している限り fallback が効かず、Stack View で「2h を確保」と誤った時間表示が出続ける。

この縮小バイアスは [ADR-0024](./0024-estimation-correction-by-category-median.md) の補正エンジンの学習素材も汚す。補正係数は「ユーザーの行動パターン」を学習したいが、現状は「prompt 制約による AI の縮小バイアス」と「ユーザーのペース差」が混ざる。AI に honest な見積もりを吐かせれば、補正係数の残差は純粋にユーザー側の信号になる。

[ADR-0038](./0038-task-size-enum.md) は `task_size` と `estimated_minutes` を別軸として並存させる方針を確定済み。本 ADR はその精神を AI 分解 prompt 側で貫徹させる位置付け。

## Decision

AI 分解 prompt から子見積もりの縮小バイアスを除去する。

1. **親 `task_size` cap を撤廃する**: 「親の task_size より大きい値を子に付けない」の指示を削除する。子の `task_size` は分解後の実態に素直に付ける。親より大きい値を付けてよい (= 親の見積もりが楽観的だったシグナル / 親自身を再分解する余地のシグナル)。
2. **`estimated_minutes` を size gate 化する**: `estimated_minutes` は「2 時間以下に収まるタスクの分単位見積もり」専用と prompt で明示する。`task_size` が `4h` / `1d` / `large` に倒れるタスクでは必ず `null` を返させる (最大バケット 120 にクリップしない)。確信度ゲートとしての null も従来通り残す。
3. **`task_size` と `estimated_minutes` の対称性を非対称に明示する**: `task_size` は必ず埋める (値域内 / 確信無ければ null)。`estimated_minutes` は ≤ 2h のときのみ整数値、それ以上のときは null。「両方を埋める」の指示を「task_size は必ず埋め、estimated_minutes は ≤2h のときのみ埋める」に置き換える。

## Consequences

### 肯定的影響

- 大物の子タスクが UI で `半日` / `1日` / `1日超` と honest に表示される ([ADR-0045](./0045-subjective-size-display-without-estimated-minutes.md) の fallback 経路に正しく乗る)
- 補正エンジン ([ADR-0024](./0024-estimation-correction-by-category-median.md)) の学習素材から AI 縮小バイアスが除去される。残差がユーザー側の信号に近づく
- 親自体が楽観見積もりだったケースで、子に大きい `task_size` が出ることで「親を再分解する余地がある」が可視化される (resplit / 自動再分解の起点になる)
- prompt の暗黙圧力に依存していた honesty が明文化され、Gemini 以外の LLM (ChatGPT / Claude) でも同じ contract が成立する

### 否定的影響・トレードオフ

- prompt が数行長くなる (size gate / cap 削除の説明文)
- AI が「2h を超えたら null」のルールを完全には守らず最大バケット 120 を返す可能性は残る。parser はフェイルソフトに 120 をそのまま受理する ([ADR-0013](./0013-ai-as-augmentation-only.md) augmentation only) ので、誤表示が完全に消えるわけではない (頻度は低下する想定)
- 大物タスクは `estimated_minutes` を持たないため、補正エンジンの直接学習対象から外れる。ただし元々バケット最大 120 だったため、>2h タスクは元から学習対象外。本 ADR は honest 化することで「学習対象だと思われていた >2h タスク」を本来の対象外領域に正しく振り分ける
- ユーザー入力の親 `task_size` が小さい場合、子が親より大きく出るケースが発生する。stack view 上で「親 1h なのに子 4h」のような違和感が出ることがあるが、これはデータの嘘ではなくシグナル (親見積もりが甘い) として正しい

## Alternatives considered

- **案 A: `estimated_minutes` のバケットを 240 / 480 / 1440 まで拡張する** — 補正エンジンが大物も学習対象にできるが、`task_size` の値域と重複し、[ADR-0038](./0038-task-size-enum.md) の「主観 (`task_size`) と推定 (`estimated_minutes`) を別軸で持つ」精神を崩す。バケット拡張は補正エンジン入力の方を変える別議論として保留 → 不採用
- **案 B: `task_size` を廃止し `estimated_minutes` 一本化** — `1日超` が表現できなくなる。[ADR-0038](./0038-task-size-enum.md) を真っ向から覆す。本 ADR の対象範囲外で議論すべき → 不採用
- **案 C: 表示層で `120 minutes` を `半日?` に書き換える** — データの嘘を別の嘘で隠す。補正エンジン入力は引き続き 120 のままなので学習信号も汚れたまま → 不採用
- **案 D: 親 cap だけ削除し `estimated_minutes` は据え置き** — 縮小バイアスが半分残る (バケット最大クリップは継続)。同じ prompt を 2 段階で改修するメリットが無い → 不採用 (本 ADR で同時対応)
- **案 E: AI が >2h と判断したら parser 側で 120 を null に倒す** — parser は AI 応答を素直に受けるべきで、prompt 指示の代替を parser でやると責務分割が崩れる ([ADR-0013](./0013-ai-as-augmentation-only.md) augmentation only) → 不採用

## Notes

- 本 ADR で解決しない既知の課題:
  - **AI 子の `task_size` と `estimated_minutes` のズレ自体は意味を持たない**: ユーザー入力タスクでは `task_size = 主観` / `estimated_minutes = 推定` のズレが行動分析素材になる ([ADR-0038](./0038-task-size-enum.md))。AI 子では両方を AI が埋めるのでズレは noise だが、prompt で過剰に一致を要求するメリットも薄いため本 ADR では強制しない
  - **補正エンジン入力に `task_size` を取り込むか** は別議論。[ADR-0038](./0038-task-size-enum.md) / [ADR-0045](./0045-subjective-size-display-without-estimated-minutes.md) で「主観を分換算しない」と決めた経緯と整合する形で再検討する必要がある (本 ADR の対象外)
- フェイルソフト: AI が指示を守らず最大バケット 120 を返した場合、parser はそのまま 120 として採用する。UI は誤った `2h` を出すが、現状の挙動と等価でリグレッションは発生しない
- 本 ADR を supersede する trigger:
  - `estimated_minutes` のバケットを拡張する方針に変える (案 A 採用時)
  - `task_size` と `estimated_minutes` のいずれかを廃止する方針に変える (案 B / 類似)
  - 補正エンジン入力に `task_size` を取り込み、size gate の前提が変わる
- dogfooding 観察項目: 大物親 (`large` / `1d`) を分解した時に、子の Stack View 表示で `半日` / `1日` / `1日超` がどの程度の比率で出るか。`120 minutes` クリップが残るケースが多ければ、prompt の文言をさらに強める (例: 出力例に `null` ケースを増やす)
