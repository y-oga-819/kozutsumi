# ADR 0022: `task_category` は task 生成経路ごとに同じ AI 呼び出しで推論する

- **Status**: Accepted
- **Date**: 2026-04-29
- **Related**: [ADR 0013](./0013-ai-as-augmentation-only.md) / [ADR 0015](./0015-task-category-ai-first-labeling.md) / [ADR 0016](./0016-stack-view-decomposition-children-only.md) / [ADR 0017](./0017-ai-task-decomposition-async.md) / [ADR 0018](./0018-keep-parent-task-id-for-ai-decomposition.md) / Issue #89 / PR #123 / Issue #124 (子経路の実装 issue)

## Context

ADR 0015 で「`task_category` は AI が初期ラベル / 人間は override」を決めたが、AI 分解 (ADR 0016 / 0017 / 0018) との関係が未定義のまま残っていた。具体的に決着が必要な論点:

1. **AI 分解で生まれた子タスクの category をどう埋めるか**。子は `decompose-server.ts` の bulk insert で生成され、AppShell の `onCreateTask` 経路を通らないので、現状 categorize は飛んでいない。
2. **「タスクが作られるたびに categorize を叩く」設計の API 呼び出し量**。子に `/api/ai/categorize` を fan-out すると 1 親で `1 (categorize) + 1 (decompose) + N (子の categorize)` = N+2 回となり、Gemini quota / latency / コストが厳しい。
3. **AI 分解された親の category の意味**。ADR 0016 で親は Stack View に出ない。ADR 0018 §否定的影響に「集計クエリで親を除外する必要」と既に注意されており、親の category は補正エンジン / 集計入力としては休眠データになる。

加えて Stack View 上、AI 分解されないケース (`decompose_status='skipped' | 'failed' | 'none'`) では親自身が leaf として並ぶ。これらの leaf には category が必要 (補正エンジン §1.5 / 行動パターン分析 §1.6 の入力軸)。つまり「Stack に並ぶタスク (leaf) は必ず category を持ちうる」という整合が要る。

## Decision

`task_category` の AI 推論は **task が生成される AI 呼び出しと同じ呼び出しで行う**。task 生成経路は 2 つあるので、それぞれに対応させる。

1. **人間作成の root task** (`AppShell.onCreateTask` 経由) → `/api/ai/categorize` を fire-and-forget で起動 (PR #123 の実装どおり)。
2. **AI 分解で生まれた子 task** (`/api/ai/decompose` 内の bulk insert) → **decompose プロンプトに category 推論を畳み込み、子レコード生成と同時に `task_category` を埋める**。子それぞれへの `/api/ai/categorize` fan-out は行わない。
3. これにより 1 親 task 作成あたりの Gemini 呼び出し数は **最大 2 回固定** (categorize 1 + decompose 1)。子の数 N に依存しない。
4. AI 分解が成功裏に終わった親 (`decompose_status='decomposed'`) の category は休眠データとして扱う。補正エンジン (P3-9) / 集計ヘルパ (P3-10) は集計入力から除外する (ADR 0018 §否定的影響と整合)。具体的な除外条件は集計ヘルパ側の責務。
5. AI 分解されない / 失敗した親 (`decompose_status='skipped' | 'failed' | 'none'`) は Stack View に leaf として残るので、root 経路で埋めた category がそのまま行カードと補正集計の入力として活きる。

decompose プロンプトの具体形式 (JSON / 別行 / fence)、parser の値域分岐、decompose が AI 失敗した時の category 欠損ハンドリング (子が生成されない以上問題にならないが、parse 部分失敗の扱い) は実装パラメータで、本 ADR では決めない (実装 issue で確定)。

## Consequences

### 肯定的影響

- **API 呼び出し数が線形にスケールしない**。1 タスク追加 = 最大 2 回の Gemini call 固定。子数 N に依存しないので quota / コストが予測可能。
- **Stack に並びうるすべてのタスクに category が乗る**。root 経路で埋めた親 + decompose 経路で埋めた子の両方で、leaf には常に category がある (AI 失敗 / `AI_ENABLED=false` で null が残る augmentation 原則は ADR 0013 のとおり)。
- **補正エンジン (P3-9) / 行動パターン分析のカバレッジに穴ができない**。分解された親由来の作業時間も種類別補正に乗る。
- **PR #123 の `task_category IS NULL` 既値ガード** (`categorize-server.ts:53`) が race condition 防衛として機能し続ける。decompose 経路で先に子の category が書かれていれば、後から categorize が走っても上書きしない (本 ADR の経路設計では起きないが、defense in depth として残る)。
- **ADR 0015 の「AI が初期ラベル」の実体が完成する**。実装範囲が「root のみ」に縛られず、すべての生成経路で初期ラベリングが効く。

### 否定的影響・トレードオフ

- **decompose プロンプトの責務が増える**。title + estimated_minutes に加えて category も同時生成させる。プロンプト設計と parser の複雑性が上がる。
- **decompose プロンプトの parse 失敗時の半端状態**。子の title / estimated_minutes は取れたが category が値域外、というケースは parser 側で「category=null で子を作る」フェイルソフトに倒す必要がある (実装 issue で確定)。
- **PR #123 では完結せず、追加 issue が必要**。decompose プロンプトに category を統合する実装 issue を別途起票する。

## Alternatives considered

- **AI 分解後に子それぞれへ `/api/ai/categorize` を fan-out**: 単純だが 1 親で N+2 回の Gemini call が発生し、quota / latency / コストが厳しい。本 ADR の最大の動機 (API 線形スケール回避) を否定する。不採用。
- **子は親の category を継承 (= 親の category を子に複製)**: 単純だが「子の作業内容は親と種類が違う」ケースが多い (例: 親「採用面接準備」= research、子「志望動機作成」= doc / 「企業情報調査」= research)。種類別補正の入力としての精度が落ちる。不採用。
- **子は当面 `task_category=null` で保留 (子戦略は別 ADR で後追い)**: 暫定状態を作る。Phase 3 / 4 のコア機能 (補正エンジン / 行動パターン分析) のカバレッジに穴が残り、立ち上がり精度が劣化する。子戦略の検討は本 ADR で済ませる方が合理的。不採用 (本 ADR の初版がこの方針だったが、議論の結果置き換えた)。
- **categorize を root / leaf 両方に飛ばし、最後に勝った方を採用**: 後勝ちの semantics が複雑で、race condition / action_log 解釈も入り組む。本 ADR で必要な複雑性ではない。不採用。
- **既存タスクの backfill と同じ仕組みで子も後追い処理する**: 即時性がなく、Stack に並んだ直後の子の category 表示が抜ける。UX 上の摩擦が大きい。不採用 (既存タスクの backfill は別問題として残る)。

## Notes

- 実装 issue で確定する項目:
  - decompose プロンプトの category 推論の組み込み形式 (JSON / 別行 / fence) と parser
  - decompose 応答で category だけ値域外になった場合のフェイルソフト (子は作る / category=null)
  - 既存 `parseDecomposeResponse` (`shared/ai/prompts/decompose.ts`) の値域拡張
- decompose プロンプト統合の実装は `TASK_CATEGORY_VALUES` (`shared/types/database.ts`) を single source of truth として参照する (PR #123 の categorize parser と同じ値域定義を共有)。
- 既存タスクの backfill (Phase 1〜2 で作られた `task_category=null` のタスク) は本 ADR の対象外。ADR 0015 Notes と整合させ、別 issue / 別判断とする。
- 本 ADR を見直す trigger:
  - decompose プロンプトの category 推論が安定せず、parse 失敗率が運用上の痛みになる (子の category null 率が高止まりする)
  - Gemini quota / コストの制約が緩和され、子に fan-out しても問題ない状況になり、別の経路設計の方が良くなる
  - ADR 0018 が supersede され「親をフラット化する」設計に切り替わる (本 ADR の前提が崩れる)
  - 補正エンジン (P3-9) で「親の category は休眠でなく集計に乗せたい」要件が出る (= ADR 0018 §否定的影響の見直し)
