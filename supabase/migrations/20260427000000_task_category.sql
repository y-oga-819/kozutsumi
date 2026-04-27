-- kozutsumi Phase 3 (P3-2, #87): tasks.task_category + task_category_changed ACTION_TYPE
--
-- References:
-- * docs/adr/0015-task-category-ai-first-labeling.md (AI が初期ラベル / 人間は override)
-- * docs/adr/0001-action-logs-from-phase1.md (action_type は text のまま JSONB で揺らぎ吸収)
--
-- 設計判断:
-- * tasks.task_category は text + CHECK (nullable, default なし)。
--   - default を置かないのは「AI ラベリング失敗時は null のまま」(ADR 0015 §6) を
--     成立させるため。Gateway / migration で 0 が紛れ込まない。
-- * 値域 (`coding` / `doc` / `research` / `admin` / `other`) は ADR 0015 Notes の通り
--   パラメータ扱い。今後の追加 / 名称変更は本 migration の supersede ではなく、
--   別 migration で CHECK を貼り直す運用。
-- * 既存タスクは null で残す (backfill しない)。CHECK は nullable を許容するので問題なし。
-- * action_logs.action_type には CHECK / enum を貼らない (ADR 0001)。
--   `task_category_changed` は code 側 (logger.ts ACTION_TYPES) に登録するだけで
--   raw SQL レベルでは即書ける。ここでは何もしない。

alter table public.tasks
  add column task_category text;

alter table public.tasks
  add constraint tasks_task_category_values
  check (
    task_category is null
    or task_category in ('coding', 'doc', 'research', 'admin', 'other')
  );
