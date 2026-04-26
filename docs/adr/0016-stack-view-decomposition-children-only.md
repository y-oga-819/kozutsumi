# ADR 0016: Stack View は AI 分解後の子のみを並べ、親は Tree View で保持する

- **Status**: Proposed
- **Date**: 2026-04-26
- **Related**: `docs/design/vision.md` / `docs/design/architecture.md` §1.7 / §1.9 / §2.4 / [ADR 0013](./0013-ai-as-augmentation-only.md) / [ADR 0017](./0017-ai-task-decomposition-async.md) / [ADR 0018](./0018-keep-parent-task-id-for-ai-decomposition.md)

> **Note (2026-04-26 後)**: 一度 Accepted にしたが、Vercel preview でプロトタイプを実際に触った結果、A の「親子関係 / 完了境界が見えない」弱点が想定より重く、C / D の長所を取り込むハイブリッド案 (E) を作って再検討する判断にした。Status を Proposed に戻して再議論中。情報設計の論点は `docs/open-questions.md` の「Stack View カード情報設計」を参照。

## Context

Phase 3 で AI (Gemini) がタスクを子タスクに分解する機能を入れる。schema には `tasks.parent_task_id` が既にあり (ADR 0018 で保持を決定)、AI 呼び出しは非同期で行う (ADR 0017)。

ここで決着が必要なのは **「親をデータ上残しつつ Stack View にどう表現するか」**。

`docs/design/architecture.md` §1.9 で Stack View は「次に何をやるかを 1 つだけ見せる」、Tree View は「過去の活動を振り返る (本質的には WBS の別 UI)」と役割分担している。`docs/design/vision.md` は「AI を育てている自覚を持たせない / 普通に便利だから使っていたら、いつの間にか提案精度が上がっている」体験を狙う。`docs/design/architecture.md` §1.7 は暗黙的フィードバックを核に据え「AI が分解した結果はそのままスタックに挿入される。承認ステップは挟まない」とする。

検討した候補は 4 案:

- **A. 子のみスタック / 親は Tree View だけ**
- **B. 子フラット + 親バッジ / グループ化**
- **C. 親をスタックに残し、展開で子を表示 (折りたたみ式)**
- **D. breadcrumb 表示**

これらは `src/features/stack-view/__experiments__/` にプロトタイプ実装し、`/experiments/adr-0016?variant=A|B|C|D` で実際に並べて触り比較した。

## Decision

**Variant A を採用する**。Stack View は AI 分解後の子のみをフラットに並べ、親はそこに出さない。

具体仕様:

1. **AI が `decomposed` 状態にした親は Stack View に出さない**。子だけが並ぶ。
2. **AI に投げていない / 分解中 / 分解不要の親はそのまま並ぶ**。並ぶ間は status pill (`未分解` / `AI 分解中` / `分解不要`) で区別する。
3. 分解結果が後から到着した瞬間、親は Stack から消えて子に置き換わる (静かなクロスフェード等の演出は実装パラメータ)。
4. 親のコンテキスト (何のための一連か) は **Tree View で見られる** ことで補完する。Stack View は「未来 / 次の 1 つ」、Tree View は「過去 + 階層構造」という役割分担を維持する。
5. 子タスクは独立した行動ログ単位として扱う。子の並べ替え / 削除 / 書き換え / 統合・再分割が `architecture.md` §2.4 の暗黙フィードバック源になる。

## Consequences

### 肯定的影響

- **vision「気づいたら細かくなってる」と最も整合する**。Stack 上で「次の 1 つ」が常に最小単位 (子) になる。
- **暗黙的フィードバック (architecture.md §1.7 / §2.4) が最大化する**。子レベルでの並べ替え / 削除 / 書き換え / 統合・再分割が 1:1 で観測できる。C (折りたたみ) では「親削除 = 子全削除なのか / 親だけか」の意味が曖昧で行動ログのセマンティクスが汚れる懸念があったが、A はその問題を持たない。
- **architecture.md §1.9 の 2 ビュー分担がクリーン**。Stack = 未来 / 1 つ、Tree = 過去 / 階層、と役割が綺麗に切れる。
- **ADR 0013 (augmentation only) と相性が良い**。AI 失敗 / `AI_ENABLED=false` の場合、親が Stack に残るだけで縮退する。e2e バイパス (ADR 0014) でも同じコードパスで動く。
- **DnD と相性が良い**。並び替え対象が常に最小粒度なので、グループ縦線 (variant B) のブツ切りや展開状態 (variant C) を考えなくて済む。
- **情報密度が低い**。各行に親バッジ / breadcrumb / 進捗等を載せる必要がない。480px width の Stack View に収まりやすい。

### 否定的影響・トレードオフ

- **親のコンテキストが Stack 上で見えない**。「志望動機パターンA作成」だけ見て「何のための?」が即答できない可能性がある。Tree View でカバーする前提で受け入れる。
- **Stack 内で粒度が混在する**。分解済み (15min 子) と未分解 (120min 親) が同居する。status pill で識別できるが、ユーザーから見ると「細かい行と大きい行が混じる」見た目になる。
- **AI 動作の察知**: 分解前→分解後で親が消えて子が増える視覚遷移が発生する。瞬間的に視認させない実装 (静かな置き換え) で緩和するが、完全に隠せはしない。vision の「育てている自覚を持たせない」は「あとから気づく / 強制的に意識させない」の意味と読み替えれば矛盾しない。
- **子タイトルの自立性が AI プロンプトに依存する**。子タイトルだけで意味が読める短い独立した文言を AI に作らせる責務が発生する。これは AI プロンプト設計 (実装パラメータ) で吸収する。
- **「親自体を着手する」という UX が Stack View からは取れない**。例えば「親 1 行を active にして時間を計りたい」ニーズは Tree View / 親詳細経由になる。Phase 3 のスコープでは許容する。

## Alternatives considered

### B. 子フラット + 親バッジ / グループ化

各子に親名バッジを付け、連続する同親の子を縦線でグルーピングする。linearity と親コンテキストの両立を狙う案。

- 不採用理由:
  - 各行に親バッジ + dep + 見積もり + status の情報が積み重なり、情報密度が高くなる
  - 並び替え (DnD) で同親グループが分断されるとグループ縦線がブツ切りになる
  - 親バッジが分解前後で増えるので、AI 動作の察知のしやすさは A と変わらない
  - 親バッジ自体が「親詳細を開く動線」として機能を持ちたくなり、Stack View の単純さが崩れやすい

### C. 親をスタックに残し、展開で子を表示 (折りたたみ)

親 1 行 = Stack 1 アイテム、展開で子と進捗 (例: `1/3`) を表示する。親子関係を UI で最も明示的に見せる案。

- 不採用理由:
  - **architecture.md §1.9 「Stack View は次に何をやるかを 1 つだけ見せる」と最も矛盾する**。展開状態によって「次の 1 つ」が親なのか展開された子の先頭なのか曖昧化する
  - 展開 / 折りたたみの操作分の認知負荷
  - **暗黙フィードバックのセマンティクスが汚れる**。「親行を削除」の意味が `親 + 全子削除` か `親だけ削除して子を孤児化` か曖昧。行動ログ (`architecture.md` §2.4) の解釈が分岐する
  - vision「気づいたら細かくなってる」の対極。AI 分解が能動的な構造として可視化される
  - linearity が崩れるので DnD との相性も悪い

### D. breadcrumb 表示

子の各行のタイトル上に「project / 親」のパスを breadcrumb で出す。linearity + コンテキスト保持を狙う案。

- 不採用理由:
  - 行が縦に伸びる (480px width で breadcrumb + title + dep + estimate + check が詰まる)
  - project は左の color dot で既に表現されており、breadcrumb の `project /` は冗長
  - 多階層 (project → epic → story → task) に拡張すると path が長くなる
  - 「親」は AI 分解の中間結果 (将来削除されたり統合される可能性がある) なので、breadcrumb で常に出すと「親が永続的な階層」という誤った印象を与える
  - 親をデータ上残す (ADR 0018) のは過去ログ用であり、UI で常に上位として見せる意図ではない

## Notes

- プロトタイプは `src/features/stack-view/__experiments__/` に置いてある。本 ADR Accepted 後 (= Phase 3 着手で実装が進んだ後) に `__experiments__/` 配下と `src/app/experiments/adr-0016/` ルート、および `src/shared/supabase/middleware.ts` の `PUBLIC_PATHS` から `/experiments` を削除する。
- 「分解結果到着前に親が active 化された」「子の見積もり継承 / `dependsOnEventId` 継承」「`task_decomposed` / `decomposition_modified` ACTION_TYPE 追加」等の派生判断は実装 issue で確定する。本 ADR は UI 表現方針までを決め、データ操作の細部には踏み込まない。
- 「分解中 → 分解済み」の遷移演出 (静かなクロスフェード等) はパラメータ寄りなので本 ADR の対象外。実装 issue で運用する。
- 将来見直す条件:
  - 親自体を Stack 上で着手するニーズが繰り返し出てくる
  - 子タイトルの自立性が低く「親文脈なしでは意味が取れない」フィードバックが蓄積する
  - 多階層 (epic / story) を Stack View で扱う必要が出てくる
  - 上記の場合、B (バッジ) や D (breadcrumb) を再評価し、本 ADR を supersede する候補にする
