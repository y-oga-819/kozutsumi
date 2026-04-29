-- kozutsumi Phase 3 (P3-9, #93): 見積もり補正エンジン用の view を追加
--
-- References:
-- * docs/adr/0023-estimation-correction-by-category-median.md (中央値で算出)
-- * docs/adr/0024-estimation-correction-via-supabase-view-and-pure-fn.md (view + TS 純粋関数)
-- * docs/adr/0004-time-entry-state-machine.md (active 区間合計 = 実作業時間)
-- * docs/adr/0015-task-category-ai-first-labeling.md (task_category null は集計外)
--
-- 設計判断:
-- * 2 段構成: 中間 view (task_actual_minutes) + 集約 view (task_category_correction_factors)。
--   - 中間 view は per-task の実作業時間。Phase 4 の行動パターン分析 (architecture.md §1.6)
--     でも再利用するため、status filter はかけない。
--   - 集約 view が ADR 0023 の「status='done' / task_category not null / 外れ値クリップ」
--     をまとめて適用する。
-- * `security_invoker = true` で RLS を caller 側に効かせる。Postgres 15+ の機能で、
--   user_id = auth.uid() の絞り込みは tasks / task_time_entries の RLS に委ねられる。
--   view 自身に RLS は付けない (PostgreSQL の view は RLS の対象外、invoker の権限で動く)。
-- * 最小サンプル数の判定は client / TS 関数で行う (ADR 0023 Notes)。
--   閾値未満の category も view には sample_count 付きで出る。
--   呼び出し側が件数を見て factor を使うかどうか決める。
-- * 中央値は `percentile_cont(0.5) WITHIN GROUP (ORDER BY ratio)`。
--   PostgreSQL 標準の集計関数で、対応する TS 純粋関数と挙動が一致する想定 (contract test 担保)。

-- =====================================================================
-- 中間 view: per-task の actual_minutes
-- =====================================================================
-- task_time_entries.duration_seconds の合計を分単位で算出する。
-- - closed entry (duration_seconds is not null) のみ集計する
-- - open entry (paused_at is null かつ duration_seconds is null) は通常 status='done' の
--   タスクには無いはずだが、念のため除外
-- - 該当 entry が無いタスクは actual_minutes = 0 で出る (coalesce)
create or replace view public.task_actual_minutes
with (security_invoker = true) as
select
  t.id as task_id,
  t.user_id,
  t.task_category,
  t.status,
  t.estimated_minutes,
  coalesce(
    (
      select sum(tte.duration_seconds)::numeric / 60
      from public.task_time_entries tte
      where tte.task_id = t.id
        and tte.duration_seconds is not null
    ),
    0::numeric
  ) as actual_minutes
from public.tasks t;

comment on view public.task_actual_minutes is
  'Per-task の実作業時間 (分)。task_time_entries の closed entry の duration_seconds を合計し、60 で割った値。Phase 3 の見積もり補正エンジン (#93) と Phase 4 の行動パターン分析 (architecture.md §1.6) で共有する。security_invoker=true なので RLS は呼び出し元の auth.uid() で評価される。';

-- =====================================================================
-- 集約 view: task_category 別の補正倍率 (中央値)
-- =====================================================================
-- ADR 0023 の集計仕様:
-- - 対象: status='done' / task_category not null / estimated_minutes > 0 / actual_minutes > 0
-- - 外れ値クリップ: actual / estimated ∈ [0.1, 10] (タイマー消し忘れ等の異常値除外)
-- - 集約方法: 中央値 (percentile_cont(0.5))
-- - サンプル数 (sample_count) も同時に返す。最小サンプル数判定は呼び出し側 (TS 関数)。
create or replace view public.task_category_correction_factors
with (security_invoker = true) as
select
  user_id,
  task_category,
  count(*)::integer as sample_count,
  percentile_cont(0.5) within group (
    order by (actual_minutes / estimated_minutes::numeric)
  ) as factor
from public.task_actual_minutes
where status = 'done'
  and task_category is not null
  and estimated_minutes is not null
  and estimated_minutes > 0
  and actual_minutes > 0
  and (actual_minutes / estimated_minutes::numeric) between 0.1 and 10
group by user_id, task_category;

comment on view public.task_category_correction_factors is
  '見積もり補正倍率 (Phase 3, #93)。task_category 別に actual_minutes / estimated_minutes の中央値 (factor) と件数 (sample_count) を返す。閾値未満の category もそのまま出るので、呼び出し側で件数を見て補正を適用するか判定する。security_invoker=true なので RLS は呼び出し元の auth.uid() で評価される。詳細は ADR 0023 / 0024。';
