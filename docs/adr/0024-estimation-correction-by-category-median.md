# ADR 0024: 見積もり補正は task_category 別の中央値で算出する

- **Status**: Accepted
- **Date**: 2026-04-29
- **Related**: `docs/design/architecture.md` §1.5 / §2.3 / [ADR 0001](./0001-action-logs-from-phase1.md) / [ADR 0004](./0004-time-entry-state-machine.md) / [ADR 0015](./0015-task-category-ai-first-labeling.md) / Issue #93

## Context

`docs/design/architecture.md` §1.5 は「ユーザーの見積もりを過去実績データで自動補正する」ことを kozutsumi のコア機能の 1 つに据えている。差別化の核 (`docs/design/vision.md`) は「行動データを蓄積して個人最適化する」ことなので、補正エンジンは Phase 3 で最初に立ち上げる「行動データの最初の output」になる。

入力は完了済みタスクの `(estimated_min, actual_min, task_category)` 3 つ組（`actual_min` は ADR 0004 の time_entries active 区間合計、architecture.md §2.3）。これを集約して `task_category` 別の **補正倍率** を出し、補正後見積もり = `estimated_min × 倍率` を表示する。

ここで「3 つ組をどう集約するか」の判断が要る。`actual / estimated` の比は経験的に対数正規分布に近く、まれに極端な裾（タイマー消し忘れで 10x、未着手で 0.05x など）を引く。素朴な算術平均を使うと裾の影響で補正倍率が不安定になり、「あなたの見積もりは信用できません」状態になって vision §1.5 の「さりげなく見せる」体験が破綻する。

## Decision

1. **補正倍率の集約は中央値**を使う。`task_category = c` の倍率 = `median({ actual_min / estimated_min | task_category = c, status = 'done' })`。
2. **外れ値クリップ**: `actual_min / estimated_min` が `[0.1, 10]` の範囲外のサンプルは集計対象から除外する（タイマー消し忘れ / 未消化のまま完了 等の異常値）。
3. **最小サンプル数**: `task_category` 別のサンプル数が閾値未満の category は補正しない（生 `estimated_min` をそのまま表示）。
4. **`estimated_min = 0` または null は集計対象外**（除算不能 / 入力欠損）。
5. **`task_category = null` のタスクは集計対象外** (ADR 0015 の方針通り)。
6. **AI / LLM は使わない**。純粋な統計処理として実装する（行動パターン分析は Phase 4 の §1.6 で別軸に拡張する）。

外れ値クリップの境界値（`[0.1, 10]`）と最小サンプル数閾値（5 件想定）は **パラメータ扱い** で、本 ADR の supersede ではない。code の constant / issue #93 で更新する。

## Consequences

### 肯定的影響

- **外れ値耐性が高い**。中央値は分布の裾に引っ張られないので、タイマー消し忘れやイレギュラーな超過を 1 件混ぜても倍率が暴れない。
- **解釈が単純**。「半分のタスクはこの補正値より早く終わる、半分はもっとかかる」と user に説明できる。vision §1.5 の「過去の実績から、このタスクには 45min 確保しています」という文言と直結する。
- **実装が単純**。SQL の `percentile_cont(0.5)` と TS 純粋関数の median 実装で同じロジックが書ける（計算場所の判断は ADR 0025）。
- **AI 不要なので fail-soft が容易**。AI 経路 (ADR 0012 / 0013) と独立に動くので、AI が落ちても補正は継続する。
- **architecture.md §1.6 の Phase 4 拡張（時間帯×タスク種類のクロス分析）と整合**。同じ集約方法で軸を増やすだけで拡張できる。

### 否定的影響・トレードオフ

- **分布のばらつき情報を捨てる**。例えば「調査系は 0.5〜3 倍と幅が大きい」という architecture.md §1.5 の特徴は、中央値だけでは表現できない。Phase 4 で「この category は信頼度が低い」と表現したくなったら 25 / 75 percentile 併記等で拡張する（本 ADR の supersede ではなく追加判断）。
- **右に裾を引く分布で過小補正になる可能性**。「中央値では 1.5x だが平均では 2.2x」のようなドキュメント系で、まれな大幅超過のリスクが補正に反映されない。Phase 4 で行動パターン分析（§1.6）を入れる時に「苦手タスクの原因推定」として補完する想定。
- **小サンプル時は補正しない判断（生値表示）が必要**。中央値はサンプル 1〜2 件では当然不安定。閾値設定でカバーするが、初期は補正が効かない期間がある。これは ADR 0015 の Consequences でも許容済み。
- **倍率が 1 を跨ぐ category（例: 0.8x）の表現**。「短く確保される」ことになる。short estimates が「軽視されている」と user に感じさせないかは UX 検証事項（issue #93 内で確認）。

## Alternatives considered

- **算術平均** `mean(a/e)`: 計算が単純だが裾の影響を受けすぎる。1 件の `actual / estimated = 10` で倍率が大幅に崩れる。クリップで対処するとしても閾値設計が中央値より重くなる。不採用。
- **幾何平均** `exp(mean(ln(a/e)))`: 比率データに対して数学的に正しい（対数正規分布の中心傾向を捉える）。しかし「幾何平均」を user に説明できる文言が無く、vision §1.5 の「さりげなく見せる」と乖離する。中央値で得られる解釈性の方が体験設計上重要。不採用。
- **重み付き平均（最近のタスクほど重い）**: 行動パターンの変化（成長 / 環境変化）を反映しやすい。しかし重みの decay 関数自体がパラメータで、middle-term の蓄積が無いと不安定。Phase 4 で行動パターン分析を入れる時に再検討する。不採用。
- **ベイズ推定（事前分布 + 観測で事後更新）**: 小サンプルでも不確かさを定量化できる。理論的には筋が良いが、実装と user 説明の両方が重く Phase 3 のスコープ外。Phase 4 以降で検討する。不採用。
- **LLM に補正させる**: ADR 0013 の augmentation only 原則に反する（補正は core path、AI が落ちたら止まる設計はダメ）。そもそも統計処理に LLM を持ち込む必然性がない。不採用。

## Notes

- 「補正値の表示の仕方」（補正後を主に、元値を控えめに併記）は vision §1.5 の implementation で、本 ADR のスコープではない。issue #93 で確定する。
- 「ユーザー入力値」と「AI 生成値」（AI 分解で生まれた子タスクの見積もり）は **データ上で区別しない**。子タスクは `parent_task_id` から AI 由来であることが暗黙に伝わる。明示的な source 列が必要になったら別 ADR で追加する。
- 計算場所（Supabase view / Route Handler / client）の判断は別 ADR (0025)。
- 値域のチューニング（外れ値クリップの境界、最小サンプル数閾値）は code 側の constant で更新する。実運用で「補正が暴れる」「効きが弱すぎる」が観測されたら issue で議論し、本 ADR は触らない。
- Phase 4 で時間帯×タスク種類のクロス分析（architecture.md §1.5）を追加する時、軸が `task_category` から `(task_category, hour_band)` に増える。集約方法（中央値）は維持できるので、本 ADR は supersede しない想定。
