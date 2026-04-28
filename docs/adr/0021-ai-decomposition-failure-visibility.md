# ADR 0021: AI タスク分解の失敗可視化と recovery 経路

- **Status**: Accepted
- **Date**: 2026-04-28
- **Related**: [ADR 0001](./0001-action-logs-from-phase1.md) / [ADR 0013](./0013-ai-as-augmentation-only.md) / [ADR 0016](./0016-stack-view-decomposition-children-only.md) / [ADR 0017](./0017-ai-task-decomposition-async.md)

## Context

ADR 0013 で AI 機能は augmentation only と決め、ADR 0017 でタスク分解は非同期 fire-and-forget と決めた。ここまでは「AI が失敗しても core 操作は止まらない」までしか保証していない。

実装段階で運用してみると、**「core を止めない」が「失敗を見えなくする」になっている**ことが分かった:

- 現状の `decomposeTask` は parse 失敗 / insert 失敗時に `decompose_status` を `none` に戻す。ユーザーから見ると「AI が試みたかどうか」「なぜ分解されなかったか」が消える
- Gemini API の quota 枯渇 (429) / network error / SDK throw は `withAiRoute` の catch-all で 500 を返すが、親タスクの状態は `decomposing` のまま固まる（rollback 漏れ）
- 失敗の種類によって取るべき recovery が違う (時間をおいて retry / 諦めて手動分解 / 再 prompt) のに、user に判断材料が無い

ADR 0001 は「行動ログは Phase 3 学習素材として削除させない」を決めており、AI の動作も同じ場所 (`action_logs`) に集めれば、状態管理と学習素材の両方を兼ねられる。

つまり、ADR 0013 / 0017 で決めた fail-soft の方針を保ったまま、**「失敗が見える」「recovery が押せる」「履歴が残る」状態を作る**判断を ADR として明示する必要がある。

## Decision

AI 分解の試行結果を `decompose_status` enum と `action_logs` で表現し、詳細パネルに集約表示する。再実行は手動 retry のみ。

### 1. `decompose_status` enum の拡張と遷移

`failed` を追加する:

| status | 意味 | 性質 |
|---|---|---|
| `none` | 未試行 / rollback 後の再試行可能状態 | 入口・再入口 |
| `decomposing` | AI 呼び出し中 | 過渡状態 |
| `decomposed` | 分解完了、子タスクあり | 終端（成功） |
| `skipped` | AI が「分解不要」と判断 | 終端（スキップ） |
| **`failed`**（新規） | 失敗 | 終端（失敗、retry で再開可） |

「終端」は自動遷移しない、ユーザー操作（再実行ボタン）でのみ動く状態を指す。

遷移:

| from | to | trigger |
|---|---|---|
| (作成) | `none` | タスク作成時の初期値 |
| `none` | `decomposing` | AI 分解実行（auto on create / 詳細パネル「再実行」） |
| `decomposing` | `decomposed` | AI 応答 valid + 子 insert 成功 |
| `decomposing` | `skipped` | AI が空配列返却 |
| `decomposing` | `failed` | parse 失敗 / quota / network / SDK error / 子 insert 失敗 |
| `failed` | `decomposing` | 詳細パネル「再実行」ボタン |
| `decomposed` | — | 再分解は scope 外（後述） |
| `skipped` | — | 再分解は scope 外（後述） |

**現状からの主な差分**: 旧実装で parse 失敗 / insert 失敗時に `none` に戻していた経路を廃止し、すべて `failed` に集約する。`decomposing` で固まらないことを不変条件にする。

### 2. 試行結果は action_log に記録する

`tasks` テーブルには raw response や reason を持たせない。理由・履歴・raw response はすべて `action_logs` に集める。新規 `action_type` 2 つを追加し、既存 1 つを拡張する:

| action_type | 状態 | metadata |
|---|---|---|
| `task_decomposed`（既存・拡張） | 成功 | `{ task_id, child_ids, raw_response }` |
| `task_decompose_failed`（新規） | 失敗 | `{ task_id, reason, raw_response?, error_message? }` |
| `task_decompose_skipped`（新規） | スキップ | `{ task_id, raw_response }` |

`reason` は失敗種別の機械可読タグ（例: `quota_exhausted` / `ai_response_unparseable` / `insert_failed` / `internal_error`）。具体的な値リストや user-facing 文言は実装定数。

詳細パネルでは `action_logs` を `task_id = $1 and action_type in (...)` で order by created_at desc limit 1 して引く。既存の `action_logs_task_id_idx` で十分（1 タスク当たりの行数規模では複合 index 不要）。

### 3. UI 表示の分担

- **スタックの task card**: status の pill のみ。既存 `StatusPill` に `failed` の分岐を追加（赤系）。reason は出さない（情報密度を上げない）。
- **タスク詳細パネル**: 「AI 分解情報エリア」を新設し、最新の試行 action_log を fetch して状態別に表示する。
  - `none`: 「AI 分解未試行」+ 「AI 分解を実行」ボタン
  - `decomposing`: 「分解中…」
  - `decomposed`: 「分解完了（子タスク N 件）」+ raw response（折りたたみ）
  - `skipped`: 「AI が分解不要と判断」+ raw response（折りたたみ、判断理由）
  - `failed`: 「分解失敗 — {reason}」+ 「再実行」ボタン + raw response（折りたたみ、debug 用）

### 4. 再実行ボタンの enable 条件

| status | ボタン |
|---|---|
| `none` | enable |
| `decomposing` | hide / disable |
| `decomposed` | **disable** |
| `skipped` | **disable** |
| `failed` | enable |

`decomposed` / `skipped` の再実行は本 ADR では扱わない（後述 Notes）。

## Consequences

### 肯定的影響

- **失敗が user に見える**。card で気付き、詳細パネルで原因と recovery を取れる。fail-soft が「失敗を隠す」になる現状を解消する。
- **ADR 0013 の不変条件は保たれる**。core path （タスク CRUD / Stack）は AI 失敗で止まらない。失敗しても親タスク自身は終端 status で残るだけ。
- **ADR 0001 と整合する**。AI の動作も行動ログに集約され、Phase 4 以降の学習素材としても使える。raw response の履歴も `action_logs` に蓄積される。
- **`decomposing` 固まりバグが構造的に直る**。例外発生時は必ず終端 status に倒すルールを強制する。
- **Gemini quota 枯渇のような upstream エラーが運用イベントとして可視化される**。「いつ落ちたか」「何回 retry されたか」が action_log で追える。

### 否定的影響・トレードオフ

- **DB 変更を伴う**: `decompose_status` enum 値追加 + 新規 action_type の運用追加。migration が必要。
- **詳細パネルから別 query が走る**: action_log を 1 件 fetch する。タスク詳細を開くたびに発生するが、index 付き single-row 取得なので影響は小さい。
- **raw response を `action_logs` に保存する分の容量**: 1 件数 KB × 試行回数。個人ツール段階では問題ない規模だが、プロダクト化時に削減方針（古い試行の raw response を null 化等）を別途検討する余地はある。
- **`decomposed` / `skipped` の再分解はできない**。子タスクの扱いや再判断のインセンティブの問題で本 ADR では扱わない（Notes 参照）。

## Alternatives considered

- **`tasks` に `decompose_raw_response` / `decompose_failure_reason` カラムを追加する**: UI 表示時に 1 query で済むメリットはあるが、再実行のたびに上書きされ履歴が消える。ADR 0001 の「行動ログは消さない」思想に反する。tasks row も raw response 数 KB で肥える。不採用。
- **失敗時の挙動を一般化して「外部 API 呼び出し全般のハンドリング ADR」にする**: retriable / user-facing / fail-fast の 3 軸で全外部 API（Gemini / Calendar / Supabase）の error handling を統一する案。抽象度が高すぎ、実態に対して overfit する判断軸が混ざる。今は AI 分解スコープに絞り、他 API は必要になった時に個別 ADR / 実装で扱う。不採用。
- **失敗時に silent retry / auto retry / circuit breaker を入れる**: quota 系は秒単位 retry しても無意味。retry / backoff 戦略は独立した判断（supersede trigger も別）なので本 ADR には含めない。必要になったら別 ADR。
- **AI 分解専用タブ（一覧画面）を作る**: 失敗中の親タスクや AI レスポンス履歴を一望できる UI。発生頻度が見えない段階で先回りで作るのは YAGNI。詳細パネル運用で問題が出たら別 ADR で検討。
- **`decomposed` / `skipped` でも再実行を許す**: `decomposed` の再分解は既存子タスクの扱い（削除 / 保持 / archive）に判断が必要で、子に既に `task_started` ログが立っている可能性もある。`skipped` は同じ prompt で AI が判断を変えるインセンティブが薄い。どちらも別判断（別 ADR）として分離する。

## Notes

- 失敗 reason の値リスト・user-facing 文言・StatusPill の色やスタイルは実装定数。本 ADR では決めない。
- `(task_id, action_type)` 複合 index は現時点で不要と判断（1 タスク当たりの action_log 行数 ~50 規模で `task_id` 単独 index で間に合う）。プロファイルで hot path と判明したら追加検討する。
- 将来見直す条件:
  - **`decomposed` / `skipped` の再分解ニーズが顕在化**: 子タスクの archive / 上書き戦略を含む別 ADR が必要になる。
  - **AI 分解失敗の頻度が高く、auto retry / circuit breaker の必要性が出る**: retry 戦略を別 ADR で検討。
  - **失敗一覧 / 履歴閲覧 UI の必要性が出る**: AI 分解専用タブを別 ADR で検討。
  - **action_logs の容量が問題化**: 古い試行の raw response 圧縮 / null 化方針を別 ADR で検討。
