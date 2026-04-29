-- kozutsumi Phase 3 (P3-12, #110): decompose_status enum に failed を追加
--
-- References:
-- * docs/adr/0021-ai-decomposition-failure-visibility.md
--   (AI 分解失敗を終端 status `failed` で表現する。`decomposing` 固まりの構造的解消)
-- * supabase/migrations/20260427100000_p3_3_decompose_status.sql
--   (enum の初期定義 4 値: none / decomposing / decomposed / skipped)
--
-- 本 migration が決めること:
--   decompose_status enum に `failed` 値を 1 つ追加する。既存値の意味は変えない。
--
-- 後続 issue で扱うもの (本 migration では触らない):
--   * server 側の遷移ロジック (P3-13, #111): parse / quota / insert 失敗で `failed` に倒す
--   * StatusPill の failed 分岐 (P3-14, #112)
--   * 詳細パネルの AI 分解情報エリア (P3-15, #113)
--   * 新規 ACTION_TYPE (`task_decompose_failed` / `task_decompose_skipped`) は
--     ADR 0001 の方針通り SQL 側に CHECK を持たないので migration 不要。
--     code 側 (src/entities/action-log) の登録で扱う (P3-13)。

alter type public.decompose_status add value if not exists 'failed';
