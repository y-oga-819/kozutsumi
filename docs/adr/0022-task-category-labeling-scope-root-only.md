# ADR 0022: AI による `task_category` 初期ラベリングの対象は人間が作成した root task のみ

- **Status**: Accepted
- **Date**: 2026-04-29
- **Related**: [ADR 0013](./0013-ai-as-augmentation-only.md) / [ADR 0015](./0015-task-category-ai-first-labeling.md) / [ADR 0016](./0016-stack-view-decomposition-children-only.md) / [ADR 0017](./0017-ai-task-decomposition-async.md) / [ADR 0018](./0018-keep-parent-task-id-for-ai-decomposition.md) / Issue #89 / PR #123

## Context

ADR 0015 で「`task_category` は AI が初期ラベル / 人間は override」を決めたが、AI 分解 (ADR 0016 / 0017 / 0018) との関係が未定義のまま残っていた。具体的に未確定だった論点:

1. **AI 分解で生まれた子タスクの category をどう埋めるか**。子は `decompose-server.ts` の bulk insert で生成され、AppShell の `onCreateTask` 経路を通らないので、現状 categorize は飛んでいない。
2. **AI 分解された親の category の意味**。ADR 0016 で親は Stack View に出ない。ADR 0018 で親は DB 上残るが、§否定的影響に「集計クエリで親を除外する必要がある」と既に注意されている。
3. **「タスク作成のたびに categorize を叩く」設計の API 呼び出し量**。子に fan-out すると 1 親で `1 (categorize) + 1 (decompose) + N (子の categorize)` = N+2 回となり、Gemini quota / latency / コストが厳しい。

加えて Stack View の運用面では、AI 分解されないケース (`decompose_status` が `skipped` / `failed` / `none`) では親自身が leaf として Stack に並ぶ。これらの leaf には category が必要 (補正エンジン §1.5 / 行動パターン分析 §1.6 の入力軸)。

## Decision

`/api/ai/categorize` の起動範囲を **「人間が `onCreateTask` 経由で作成した root task のみ」** に限定する。

1. categorize 起動経路は AppShell の `onCreateTask` 成功後の `triggerCategorize` のみ。AI 分解で生まれた子タスクへは飛ばさない。
2. AI 分解で生成された子タスクは `task_category=null` のまま生まれる。子の labeling 戦略 (decompose プロンプトへの統合 / 子への fan-out / backfill) は **本 ADR の範囲外**。別 ADR + 別 issue で扱う。
3. AI 分解が成功裏に終わった親 (`decompose_status='decomposed'`) の category は休眠データとして扱う。補正エンジン (P3-9) / 集計ヘルパ (P3-10) は集計入力から除外する (ADR 0018 §否定的影響と整合)。具体的な除外条件は集計ヘルパ側の責務で、本 ADR では決めない。
4. `decompose_status` が `skipped` / `failed` / `none` の親は Stack View に leaf として残るので、category がそのまま行カードと補正集計の入力として活きる (本決定どおり root に対する初期ラベリングが効く対象)。

## Consequences

### 肯定的影響

- **API 呼び出し数が線形にスケールしない**。1 タスク追加 = 最大 2 回 (categorize + decompose)。子の数 N に依存しない。
- **ADR 0015 (AI 初期ラベル) の実装範囲を破綻なく確定できる**。Phase 3 / 4 のコア機能 (補正エンジン / 行動パターン分析) は leaf 単位で集計するので、root + leaf に label が付いていれば入力軸は揃う。
- **ADR 0013 (augmentation only) と整合**。子の category が null のままでも core は止まらない。
- **PR #123 の `task_category IS NULL` 既値ガード** (`categorize-server.ts:53`) が将来「子にも label を入れる」拡張時の race condition 防衛として再利用できる。本 ADR で実装範囲を絞ることで、この既値ガードの設計が無駄にならない。
- **集計ヘルパ (P3-10) の入力定義がシンプルになる**。「leaf (Stack に並ぶタスク) のみ集計」という単一のルールで済む。

### 否定的影響・トレードオフ

- **AI 分解で生まれた子は当面 `task_category=null`**。分解された親由来の作業時間は補正エンジンの種類別倍率に乗らない (集計対象から漏れる)。
- **Phase 3 / 4 の機能精度に短期的な影響**。「分解されない / 失敗する / 短い」タスクだけが補正の入力に乗るので、ユーザーの作業全体を代表しない可能性がある。
- **暫定的な状態**。子の labeling 戦略が決まるまで、補正エンジンのカバレッジに穴が残る。

## Alternatives considered

- **AI 分解後に子それぞれに `/api/ai/categorize` を fan-out**: 単純だが 1 親で N+2 回の Gemini call が発生する。quota / latency / コスト的に正当化しづらい。不採用。
- **`decompose` プロンプトに category 推論を統合**: 1 回の API call で title + estimated_minutes + category を同時生成できるので API 数は増えない。**有力候補だが本 ADR では確定しない**。プロンプトの安定性 / parser 値域分岐 / decompose 失敗時に category だけ取り出す可否、いずれも検証が足りない。子の labeling 戦略を別 ADR で起票する際に再検討する。
- **子は親の category を継承 (= 親の category を子に複製)**: 単純だが「子の作業内容は親と種類が違う」ケースが多い (例: 親「採用面接準備」= research、子「志望動機作成」= doc / 「企業情報調査」= research)。種類別補正の入力としての精度が落ちる。不採用。
- **categorize を root / leaf 両方に飛ばし、最後に勝った方を採用**: 後勝ちの semantics が複雑で、race condition / action_log 解釈も入り組む。本 ADR で必要な複雑性ではない。不採用。
- **Phase 3 着手時点では categorize 自体を見送り、人手 override だけで運用**: ADR 0015 が「AI が初期ラベル」と決めているので、本 ADR でこれを覆すのは粒度が違う (ADR 0015 の supersede になる)。本 ADR は ADR 0015 の **実装範囲の明確化** にとどめる。

## Notes

- 子の labeling 戦略を別 ADR で起票するべき trigger:
  - 補正エンジン (P3-9) で「分解された親の作業時間 (子の合計) を種類別補正に乗せたい」要件が顕在化する
  - decompose プロンプトの安定性が検証され、category 推論を統合できる確信が持てる
  - 既存タスクの backfill 設計と一緒に扱える状況になる
- 上記 trigger が来た時点で本 ADR を supersede するのではなく、**子戦略を扱う補完 ADR** を起票する想定。本 ADR の判断 (root only) は子戦略の採用後も「root に対する初期ラベリングは onCreateTask 経路で行う」という形で残るため。
- PR #123 (P3-4 categorize 実装) は本 ADR の範囲どおり root only で実装されている (`AppShell.tsx:686` の `triggerCategorize` のみが起動経路)。本 ADR 起票による実装変更は不要。
- 本 ADR を見直す trigger:
  - 補正エンジンのカバレッジ穴 (分解された親由来の作業時間が乗らない問題) が運用上の痛みになる
  - Gemini quota / コストの制約が緩和され、子に fan-out しても問題ない状況になる
  - ADR 0018 が supersede され「親をフラット化する」設計に切り替わる (本 ADR の前提が崩れる)
