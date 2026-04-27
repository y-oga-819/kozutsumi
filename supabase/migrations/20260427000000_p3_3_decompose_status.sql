-- kozutsumi Phase 3 (P3-3): AI 分解状態の管理列 + 関連 ACTION_TYPE
--
-- References:
-- * docs/adr/0017-ai-task-decomposition-async.md
--   (タスク追加は即時 / AI 分解は非同期。親に「分解中 / 分解済み / 分解不要」状態が必要)
-- * docs/adr/0018-keep-parent-task-id-for-ai-decomposition.md
--   (parent_task_id でデータ上保持。ON DELETE ポリシー / 状態列の具体は実装 issue で確定)
-- * docs/adr/0016-stack-view-decomposition-children-only.md
--   (Variant E。decomposed の親は Stack に出さず、子だけがフラットに並ぶ)
-- * docs/adr/0001-action-logs-from-phase1.md
--   (action_logs.action_type は text。新 ACTION_TYPE は SQL 制約ではなく
--    アプリ層の TypeScript 型 / ACTION_TYPES に定義する)
--
-- 本 migration が決めること:
-- 1. tasks.decompose_status enum 列 (default 'none')
-- 2. parent_task_id ON DELETE ポリシーを SET NULL に確定 (既存挙動を維持しコメントで明文化)

-- =====================================================================
-- 1. decompose_status enum + tasks 列追加
-- =====================================================================
--
-- ADR 0017 で定義した 4 値:
--   none        : 分解未試行 (Phase 1〜2 で作られた既存タスク含む)
--   decomposing : AI 分解 fire-and-forget 中
--   decomposed  : AI 分解結果が反映済み (子レコードが parent_task_id で参照)
--   skipped     : AI が「分解不要 (=既に十分小さい)」と判断 / AI_ENABLED=false 等
--
-- enum 採用理由: 既存の task_status / event_source / pause_reason と同様の
-- パターンで揃えるため。text + CHECK でも要件は満たせるが、SQL 型として
-- 揃っている方が gen types typescript の出力が綺麗で、フロント側の literal
-- union と 1:1 対応する。

create type public.decompose_status as enum ('none', 'decomposing', 'decomposed', 'skipped');

alter table public.tasks
  add column decompose_status public.decompose_status not null default 'none';

comment on column public.tasks.decompose_status is
  'ADR 0017 / 0018: AI 分解の段階。Stack View (ADR 0016 Variant E) は decomposed の親を出さず子のみ並べる。';

-- =====================================================================
-- 2. parent_task_id ON DELETE ポリシー: SET NULL に確定
-- =====================================================================
--
-- 既存 schema (20260419000000_initial_schema.sql) が `ON DELETE SET NULL` で
-- 作られているので、列の再作成は行わずコメントで判断を明文化する。
--
-- 候補と判断:
--   * cascade   : 親削除で子も全部消える。AI が分解した子はユーザーが触ってきた
--                 実体 (時間記録 / 完了履歴) を持つので、親側の操作で連鎖削除する
--                 のは破壊的すぎる。不採用。
--   * restrict  : 子がある親は削除不可。ユーザー視点の「親統合」操作 (子を
--                 全部別タスクに付け替えてから親を削除) を毎回明示要求するのは
--                 摩擦が大きい。不採用。
--   * set null  : 子は孤児化するが残る。ADR 0018 の「親だけ削除して子を残す =
--                 親統合」セマンティクスと整合する。採用。
--                 孤児化された子は parent_task_id = null で通常の Stack 行に
--                 戻り、後から `decomposition_modified` ACTION_TYPE で記録する
--                 (詳細は src/entities/action-log/types.ts)。

comment on constraint tasks_parent_task_id_fkey on public.tasks is
  'ADR 0018: 親削除時は子を孤児化 (SET NULL)。親統合セマンティクスとして decomposition_modified に記録する。';

-- =====================================================================
-- 3. ACTION_TYPE の拡張について
-- =====================================================================
--
-- action_logs.action_type は text 列で、SQL 側に CHECK 制約や enum を持たせて
-- いない (ADR 0001: 新 ACTION_TYPE 追加コストを下げる設計)。本 migration は
-- スキーマを変えず、以下 2 種を TypeScript 側 (src/entities/action-log) で
-- 定義する:
--
--   task_decomposed         : AI 分解成功時、子作成と同時に記録
--                             metadata: { task_id (=親), child_ids: string[] }
--   decomposition_modified  : 分解後に子の削除 / 統合 / 再分割 / 編集が起きた総称
--                             metadata: { task_id, parent_id, kind: 'child_deleted'
--                                         | 'child_edited' | 'child_resplit'
--                                         | 'parent_merged' }
--
-- task_merged / task_split を別 ACTION_TYPE として切り出す判断は本 issue では
-- 行わない (操作 UI が固まる P3-7+ で必要になれば追加)。それまでは
-- decomposition_modified.kind で区別する。
