-- kozutsumi (issue #169): tasks.task_size 列追加 (ADR 0036 / 0038)
--
-- References:
-- * docs/adr/0038-task-size-enum.md (ユーザー意図サイズと AI 推定の分離)
-- * docs/adr/0036-simplify-task-registration-workflow.md (登録時の認知負荷削減)
-- * docs/adr/0022-task-category-labeling-per-generation-path.md (text + CHECK パターンの先行例)
--
-- 設計判断:
-- * tasks.task_size は text + CHECK (nullable, default なし)。
--   - default を置かないのは「未設定 = 既存挙動 (estimated_minutes ベース)」で
--     後方互換を取るため (ADR 0038 §Decision)。0 や '' が紛れ込まない。
-- * 値域 (`15m` / `30m` / `1h` / `2h` / `4h` / `1d` / `large`) は ADR 0038 §Decision で
--   確定。値域変更は本 migration の supersede ではなく、別 migration で CHECK を貼り直す
--   運用 (ADR 0022 と同じ)。
-- * 既存タスクは null で残す (バックフィルしない)。CHECK は nullable を許容する。
-- * 補正エンジン (ADR 0024〜0026) は estimated_minutes 軸のまま継続動作するため、
--   本列は補正エンジンの入力ではない。Phase 4 行動分析の独立シグナル。

alter table public.tasks
  add column task_size text;

alter table public.tasks
  add constraint tasks_task_size_values
  check (
    task_size is null
    or task_size in ('15m', '30m', '1h', '2h', '4h', '1d', 'large')
  );
