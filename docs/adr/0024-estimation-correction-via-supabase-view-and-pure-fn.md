# ADR 0024: 見積もり補正の計算は Supabase view + TS 純粋関数の二重実装で行う

- **Status**: Accepted
- **Date**: 2026-04-29
- **Related**: [ADR 0012](./0012-ai-call-via-route-handler.md) / [ADR 0019](./0019-db-migration-via-manual-github-actions.md) / [ADR 0023](./0023-estimation-correction-by-category-median.md) / Issue #93

## Context

ADR 0023 で「`task_category` 別の中央値で補正倍率を出す」と決めた。続いて「どこで計算するか」の判断が要る。

選択肢:

1. **Supabase view**: SQL 1 本で集約。client から PostgREST 経由で読む。RLS で auth が守られる。
2. **Next.js Route Handler**: server 側で集計。client から fetch する。
3. **Client 集計**: 完了済みタスクと time_entries を素で取って JS で集計。
4. **Materialized view + cron refresh**: pre-compute + キャッシュ。

issue #93 の完了条件「倍率算出ロジックがユニットテストで踏める」も満たす必要がある。SQL 単体ではテストしづらいので、テスト経路の設計も含めて判断する。

ADR 0012 で「AI 呼び出しは Route Handler」と決めているが、補正エンジンは ADR 0023 の通り **AI を使わない純粋な統計処理**。AI 経路と紛らわしいので「Route Handler に乗せるかどうか」も明示的に切り分ける必要がある。

## Decision

1. **本番の集計経路は Supabase view**。`task_category_correction_factors`（仮）を作り、PostgREST 経由で client から read する。auth は RLS で守る。
2. **同じロジックを TS 純粋関数として並走させる**。`src/entities/task/aggregations.ts` 配下に median / 外れ値クリップ / 最小サンプル数判定を切り出し、ユニットテストで踏む。
3. **両者の一致は contract test で担保**。同じ入力データで view と TS 関数が同じ倍率を返すことを統合テストで踏める形にする。
4. **Route Handler は使わない**。補正エンジンは AI を使わない (ADR 0023) ので、ADR 0012 の Route Handler 方針を適用する必要がない。

view の具体的な SQL（`percentile_cont(0.5) WITHIN GROUP ...` の使用、time_entries 集計の中間 view 化など）は実装 issue で確定する。本 ADR は「view を採用する」までを決める。

## Consequences

### 肯定的影響

- **AI 経路と完全に独立**。ADR 0013 の augmentation only 原則と整合し、AI が落ちても補正は走り続ける。e2e (ADR 0014) も `AI_ENABLED=false` の影響を受けない。
- **auth check の重複が無い**。RLS で user 単位の分離が自動で守られる。Route Handler 案だと auth check のコードを増やすことになる。
- **cache 戦略が要らない**。Phase 3 のサンプル数規模（user あたり完了タスク数百〜数千）なら view のリアルタイム集計で十分。materialized view + cron 案より運用負荷が低い。
- **ユニットテストは TS 純粋関数で踏める**。SQL 単体テストの代わりに contract test で同等性を担保すれば、issue #93 の完了条件を満たせる。
- **将来の補正経路追加に対して拡張点が明確**。「補正後の値をスケジューラ計算に使う」など server 側で倍率が要る用途が出ても、view を SQL で join するか、Route Handler から view を読むか、選べる。

### 否定的影響・トレードオフ

- **同じロジックを SQL と TS に二重実装する dev cost**。median の挙動・外れ値クリップ・最小サンプル数閾値の境界条件が両方で一致している必要がある。contract test を必ず置く。
- **大規模化時の view パフォーマンス**。完了タスクが数万件規模になると view の集計が遅くなる可能性。Phase 3 では問題にならないが、Phase 4 で行動パターン分析（時間帯×タスク種類のクロス）を入れる時に再検討する trigger になる。
- **PostgREST の SQL 表現力に依存**。`percentile_cont` は PostgreSQL 標準なので問題ないが、将来 view の SQL が複雑化したら Route Handler に移す判断が出る可能性がある。その時点で本 ADR を supersede する。
- **migration コストが増える**（ADR 0019 / 0020 のフローに 1 本追加）。view 1 本なので影響は小さい。

## Alternatives considered

- **Route Handler で集計**: 案 (2)。AI 経路と紛らわしくなり、auth check コードを増やす。view と比べて性能・運用上の利点が無い。Phase 3 では不採用。将来 view では表現できないロジック（複数 user 間の比較・cache 制御等）が必要になったら再検討する。
- **Client 集計**: 案 (3)。PostgREST で raw データを取って JS で集計。SQL の集計能力を使えず、転送量も大きい。スケールしない。不採用。
- **Materialized view + cron refresh**: 案 (4)。pre-compute されるので read が速い。しかし Phase 3 のサンプル数規模では普通の view で十分速く、cron 運用と stale data の handling が増える。Phase 4 でパフォーマンス課題が観測されたら再検討する。不採用。
- **TS 関数だけで完結 (view を作らない)**: 完了タスクと time_entries を client / Route Handler に raw で持ってきて TS 純粋関数で集計。SQL 不要なので dev cost は低い。しかし PostgREST 経由で raw を取ると数千件 × 2 テーブルになり、ネットワーク転送と JS 集計コストが view より重い。本ロジックは「読むたびに集計」前提なので不利。不採用。

## Notes

- view 名 `task_category_correction_factors`、中間 view（time_entries の active 区間合計など）の有無は実装 issue で確定。
- `actual_min` の算出は ADR 0004 の time_entries（active 区間合計）。view 内で `time_entries` の `duration_seconds` を `task_id` 別に集計する中間 view を立てるか、メイン view で直接 join するかは実装判断。
- contract test は seed データを Supabase に流し込み、同じ user_id について view の出力と TS 純粋関数の出力が一致することを確認する形。e2e のフィクスチャ (ADR 0011) と共有できるなら共有する。
- 本 ADR を supersede する trigger:
  - サンプル数の規模が増えて view が遅くなり、materialized 化や Route Handler 経由の cache が必要になる
  - SQL では表現しきれないロジック（複数 user 比較・推奨アルゴリズム等）が補正に必要になる
  - ADR 0023 の集約方法が中央値以外に変わり、SQL 実装が困難になる
