# ADR 0018: AI 分解の親タスクは `parent_task_id` でデータ上保持する

- **Status**: Accepted
- **Date**: 2026-04-26
- **Related**: `docs/design/architecture.md` §1.7 / §1.9 / §2.1 / §2.4 / [ADR 0001](./0001-action-logs-from-phase1.md) / [ADR 0016](./0016-stack-view-decomposition-children-only.md)

## Context

Phase 3 で AI 分解 (ADR 0012 / 0017) を入れる際、親子関係をデータ構造としてどう持つかに 2 つの方向性がある:

1. **親子を保持する**: `tasks.parent_task_id`(既存 schema) を残し、AI が親を分解したら子を作って親を `decomposed` 状態にする。親レコードは残し続ける。
2. **親子を持たず、分解で親を消す**: AI 分解時に親レコードを削除し、子だけを独立タスクとして残す。階層は持たない。

`docs/design/architecture.md` §2.1 は project + task の 2 階層を基本としつつ epic / story を中間層として許容しており、`parent_task_id` を持つ schema は元々この階層構造の表現として導入されている。

`docs/design/architecture.md` §2.4 の行動ログには「タスクの統合・再分割」「分解されたタスクの削除・修正」が含まれており、これらは「親と子の関係」をデータとして保持していなければ意味のあるログにならない。

`docs/design/architecture.md` §1.9 は Stack View (未来) と Tree View (過去 / WBS) の役割分担を定めており、Tree View では親階層を見せる前提が読める。ADR 0016 で Stack View は親を出さない判断をした以上、親が「どこかには残っている」ことは前提条件になる。

## Decision

AI 分解で生まれた子タスクは **`tasks.parent_task_id` で親を参照し、親レコードは保持する**。

1. AI 分解時に親レコードを **削除しない**。子レコードは `parent_task_id = <親.id>` で参照する。
2. 親には「分解済み」状態を持たせる (具体的なフラグ列の追加 / 既存 status enum に値を増やす等は実装 issue で確定)。
3. **Stack View は ADR 0016 のとおり親を出さず、子だけを並べる**。親は Tree View でのみ可視化される。
4. **`parent_task_id` はデータ整合性制約として残す**。子だけ削除して親を孤児化する / 親だけ削除して子を残す挙動は、それぞれ別の意味 (再分割 / 親統合) を持つので別 ACTION_TYPE で記録する (詳細は実装 issue)。
5. **既存タスク (Phase 1〜2 で作られた `parent_task_id = null` のタスク)** は何も変更しない。AI 分解の対象になって初めて子が生え、親が `decomposed` 状態になる。

値域 / DB 制約 / 状態管理の具体は実装 issue で詰める (パラメータ扱い)。本 ADR は「親をデータ上残す」の判断までを決める。

## Consequences

### 肯定的影響

- **行動ログ (`architecture.md` §2.4) のセマンティクスが豊かになる**。「分解された子の削除」「分解された子の書き換え」「子の再分割」「子の統合」がそれぞれ親子関係を辿って解釈できる。これは Phase 4 の暗黙的フィードバック分析の入力になる。
- **Tree View の表現が自然**。親 → 子の階層がそのまま `parent_task_id` で辿れる。`architecture.md` §1.9 の WBS メタファーと整合する。
- **ADR 0016 (Stack View に親を出さない) の前提が成立する**。「親を出さない代わりに Tree View で見られる」役割分担はデータ上の親保持があって初めて意味を持つ。
- **AI 分解の品質改善ループが回る**。「ユーザーが子を統合した = 分解粒度が細かすぎた」「子を再分割した = 粗すぎた」が `parent_task_id` 経由で集計できる。
- **`architecture.md` §2.1 の階層モデル (project + task の 2 階層 + 中間層オプショナル) と整合する**。AI 分解で生まれる親子は事実上「story → task」相当の中間階層として扱える。

### 否定的影響・トレードオフ

- **`tasks` テーブルに「実体としては並ばない親レコード」が増える**。Stack View に出ないので user から見えにくく、削除 / 一覧の運用で考慮が必要。Tree View / タスク詳細パネルで明示する責務がある。
- **集計クエリが `parent_task_id` を意識する必要がある**。例えば「未着手タスク数」を出すときに親レコードを除外しないとダブルカウントする。実装 issue で集計ヘルパを整理する。
- **`parent_task_id` の foreign key 整合性**: 親を削除したら子は孤児化するか cascade delete するかの判断が必要。本 ADR では決めない (実装 issue で `ON DELETE` ポリシーを確定する)。
- **将来「階層を完全に捨ててフラットなタスク集合 + AI 学習データを別 table」型に切り替える**選択肢を捨てている。supersede 条件は Notes 参照。

## Alternatives considered

- **AI 分解時に親を削除し、子だけを独立タスクにする**: 階層を持たないフラット設計。
  - 不採用理由:
    - `architecture.md` §2.4 の行動ログ (統合 / 再分割) が解釈不能になる (親が無いので「再分割」が「単に新しい子を追加」と区別できない)
    - Tree View の親階層表現が成立しない (ADR 0016 の Stack 役割分担が壊れる)
    - AI 分解の精度改善ループの入力が消える (どの親に対する子だったかが失われる)
- **子に親を埋め込む (`parent_title`, `parent_id` を文字列で持つ)**: 正規化を捨てて子レコードにメタデータとして親情報を入れる。
  - 不採用理由:
    - `parent_task_id` (既存 schema) を捨てる強い理由がない
    - 親が編集 / 削除されたときの伝播が手動になる
    - 階層クエリ (Tree View) が書きにくくなる
- **親子関係を別テーブル (`task_decompositions`) に切り出す**: `tasks` 本体には階層を持たせず、関係テーブルに分解履歴を書く。
  - 不採用理由:
    - `tasks.parent_task_id` で済む話を別テーブルにする overhead に見合わない
    - join が一段深くなり Tree View / 集計クエリのパフォーマンスが落ちる
    - 「Phase 1 から `parent_task_id` がある」という既存事実を覆す利点が薄い

## Notes

- `parent_task_id` の DB 列追加は不要 (既存 schema)。新たに必要なのは「親が分解済みであることを示す状態管理」と「Stack View 描画フィルタ」だけ (実装 issue)。
- `ON DELETE` ポリシー (cascade / set null / restrict) の選択は実装 issue で確定する。
- 統合 / 再分割の操作 UI と対応する ACTION_TYPE 追加 (例: `task_merged` / `task_split`) も実装 issue で扱う (ADR 0001 の延長線)。
- 将来見直す条件:
  - 親レコードのオーバーヘッド (集計の煩雑さ / Tree View が肥大化する等) が顕在化する
  - 分解履歴の独立 table 化が他用途 (例: 提案候補の保存 / 比較) で必要になる
  - 階層モデル自体が project + task のフラット化に倒される (architecture.md §2.1 の見直し)
