-- kozutsumi (issue #246): tasks に完了条件 3 列を追加 (ADR 0061 / 0066)
--
-- References:
-- * docs/adr/0061-ai-decomposition-one-hour-target-and-done-condition-schema.md
--   (各子タスクに完了条件を AI が言語化する)
-- * docs/adr/0066-decompose-completion-criteria-deliverable-done-first-step.md
--   (完了条件 schema を deliverable / done / first_step の 3 項目に確定。
--    物理表現 = カラム追加 or JSONB は #246 の実装判断に委譲)
-- * supabase/migrations/20260504000000_task_size.sql (列追加 + フェイルソフト列の先行例)
--
-- 設計判断 (ADR 0066 が #246 に委譲した「物理表現」の確定):
-- * `completion_criteria` JSONB 1 列ではなく `deliverable` / `done` / `first_step` の
--   3 text 列を追加する。理由:
--   - ADR 0066 §否定的影響 / #247 (親進捗可視化) / #245 (AI 後追い補完) が field 単位で
--     アクセスする。列なら CHECK / index / クエリが素直で、JSONB のキー欠損ガードが要らない。
--   - 既存の構造化属性 (task_category / task_size) と同じく「1 属性 1 列」で揃う。
-- * `text not null default ''`。body 列 (`text not null default ''`) と同じ扱い:
--   - ADR 0066 §Decision: 3 項目はフェイルソフトで空文字を許容する (必須にしない)。
--     「未設定」「AI が言語化できなかった」をどちらも空文字で表し、null は導入しない。
--   - 既存タスク (Phase 1〜2 由来 / ADR 0064 の title のみ作成) は空文字で backfill される。
-- * 値域 CHECK は置かない。body と同じ自由テキスト。長さの hard cap は AI parser 側
--   (MAX_CRITERION_LEN, src/shared/ai/prompts/decompose.ts) で持つ。

alter table public.tasks
  add column deliverable text not null default '',
  add column done text not null default '',
  add column first_step text not null default '';

comment on column public.tasks.deliverable is
  'ADR 0066: 完了条件。そのタスクが生む成果物 (名詞)。フェイルソフトで空文字を許容。';
comment on column public.tasks.done is
  'ADR 0066: 完了条件。deliverable が完成したと言える観測可能な条件。フェイルソフトで空文字を許容。';
comment on column public.tasks.first_step is
  'ADR 0066: 完了条件。着手の最初の一手。フェイルソフトで空文字を許容。';
