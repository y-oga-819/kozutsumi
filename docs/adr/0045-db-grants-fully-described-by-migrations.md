# ADR 0045: public schema の table-level GRANT は migration が完全記述する

- **Status**: Accepted
- **Date**: 2026-05-04
- **Related**: [ADR-0001](./0001-action-logs-from-phase1.md) / [ADR-0019](./0019-db-migration-via-manual-github-actions.md) / [ADR-0042](./0042-preview-env-uses-separate-supabase-project.md) / [ADR-0043](./0043-preview-db-migration-auto-apply-on-pr-push.md) / Issue #200

## Context

Issue #200 で、preview Supabase project (ADR-0042) において `authenticated` ロールが
public schema の table 群に対して table-level GRANT を持っておらず、ログイン後の全 REST 呼び出しが
`42501 permission denied for table` で 403 を返す事象が発覚した。

本番 project では同じコードが動いている。原因は **project 初期化時刻に依存する Supabase の default**:

- 本番 project: 古めの (緩めの) default で初期化された時代に作られた、または Studio 経由で
  table が作られたため、`authenticated` への table-level GRANT が **暗黙に** 効いている
- preview project: 新しめの strict default で初期化されたため、その暗黙 GRANT が **無い**

`supabase/migrations/` の中身は両環境で同一だが、**migration 外の暗黙状態**（project 初期化時の
default privileges）が環境差として残り、preview を分離した時点で初めて顕在化した。

これは「migration files が DB 状態を完全に記述する」という前提が崩れていることを意味する。
具体的な症状（preview の 403）だけ直しても、構造的には以下のリスクが残る:

- preview を ADR-0043 の reset で作り直すたびに同じ問題が再発する
- 新規 Supabase project でローカル開発を始める人 / 将来の自分が同じ罠を踏む
- 別の権限属性（GRANT 対象 / role / schema）でも、本番だけ暗黙 OK で preview だけ NG という
  ズレが起きうる

短期 fix（preview の SQL Editor で手動 GRANT）は ADR-0043 の reset で消えるので恒久対応にならない。
preview project 側だけ initialization script を仕込む案も、本番との差分を温存するだけで
「migration 外の暗黙状態」問題自体は解けない。

## Decision

**public schema の table-level GRANT（`authenticated` 等のアプリ用ロールへの権限付与）は、
project 初期化時の暗黙 default に依存せず、`supabase/migrations/` の中で明示的に宣言する。**

この原則の含意:

- 既存 table への GRANT を表明する migration を 1 本書き、本番 / preview / 新規環境すべてに適用する。
  本番では事実上 no-op（既存暗黙 GRANT と等価）、preview では実体変化を起こす
- 今後新規 table を追加する migration は、その table を GRANT 対象に含める責務を持つ。
  または `ALTER DEFAULT PRIVILEGES` で「今後 postgres が public schema に作る table」を
  自動 GRANT 対象にする（本 ADR の初回 migration でこの宣言も行う）
- `anon` には GRANT しない（ADR-0001 と整合 / Phase 1 は未認証で DB を触らせない方針）

本 ADR の射程は **public schema の table-level GRANT のみ**。`auth.*` / `storage.*` / `supabase_*`
等の Supabase 管理 schema、function に対する `grant execute`、column-level privilege は
本 ADR の対象外（必要になった時点で別 ADR で扱う）。

## Consequences

### 肯定的影響

- **「migration が DB 状態を完全記述する」原則が GRANT レイヤでも成立する**。
  本番 / preview / 新規環境の DB 状態が等価になり、環境差バグが構造的に消える
- **preview reset / 再生成のたびに同じ罠を踏まない**（ADR-0043 の運用が安定する）
- **新規 Supabase project でローカル開発を始める人が罠を踏まない**。`supabase db push` だけで
  権限状態まで再現できる
- **本番への適用は ADR-0019 の手動 + approval ワークフローに乗る**。本番では no-op であることを
  事前に検証できる（`\dp public.<table>` 等で既存暗黙 GRANT を確認）ため慎重さは保たれる
- **新規 table 追加時の GRANT 漏れを構造的に防ぐ**。`ALTER DEFAULT PRIVILEGES` により
  postgres role が今後作る table は authenticated に自動 GRANT される

### 否定的影響・トレードオフ

- **本番 DB に「事実上 no-op」の migration を流すという初体験**を 1 回行う必要がある。
  運用上は ADR-0019 のフロー通りだが、「本番に流して何も変わらない」という確認手順
  （`\dp` 等での事前 / 事後比較）を最初の 1 回はやる
- **`ALTER DEFAULT PRIVILEGES` は「実行 role が今後作る object」に効く**ため、
  実行 role が postgres から変わると効果範囲がズレる。Supabase の migration apply は
  postgres role 固定なので現状は問題ないが、将来 migration runner 構成が変わる時は本 ADR を見直す
- **本 ADR は「table-level GRANT」だけを対象**としており、column-level / function / 他 schema は
  別途。GRANT レイヤ全部を 1 ADR で扱うと粒度が大きくなりすぎるので意図的に絞る
- **`authenticated` には RLS で制御するとはいえ全 table の SELECT/INSERT/UPDATE/DELETE が
  table-level で許可される**。RLS が無効化された table が 1 枚でもあれば情報漏洩経路になる。
  これは ADR-0023 の「新規 public table は RLS 必須」検査と組で初めて安全になる
  （compare.mjs が CI で守る）

### 何をしないか（境界）

- **`auth.*` / `storage.*` 等 Supabase 管理 schema の権限は触らない**。これらは Supabase 側の
  default に従う
- **column-level GRANT は本 ADR の対象外**。必要になったら別 ADR
- **`anon` への GRANT を仕込まない**。Phase 1 方針 (ADR-0001 と整合) を維持
- **本番 default privileges を「Supabase 側の暗黙状態」に依存させ続けない**ことが趣旨であり、
  暗黙状態を「消す」操作（REVOKE）は行わない。本番の現状 GRANT を保ちつつ、migration で
  再宣言するだけ

## Alternatives considered

- **preview project の SQL Editor で手動 GRANT する（短期 fix のみ）**:
  ADR-0043 の reset で消えるので毎回手作業が必要。「migration 外の暗黙状態」問題が残る。不採用

- **preview project だけ initialization SQL を仕込む（preview 専用 hook）**:
  本番 / preview の差分を温存する。新規環境でローカル開発を始める人にも GRANT 状態は再現されない。
  「migration が DB 状態を完全記述する」原則に反する。不採用

- **Supabase 側の default privileges を本番 / preview で揃える（dashboard 設定）**:
  Supabase 公式に project 初期化時の default privileges を後から再現する経路は無い。
  あったとしても dashboard 設定は migration files に記述されないので暗黙状態として残る。不採用

- **GRANT 対象を最小化する（action_logs は SELECT/INSERT のみ等、RLS policy と合わせる）**:
  table-level GRANT を「permissive、RLS が gatekeeper」と割り切るか、policy と完全一致させるかの
  判断。完全一致は migration の冗長性が増し、policy 変更のたびに GRANT も touch する保守負荷が出る。
  RLS が enable されていれば table-level の差は実効に影響しないので、permissive で統一する。
  ただしこの判断は本 ADR の射程内に含めず、初回 migration の実装判断として閉じる
  （将来「policy と完全一致させる」運用に変える時はここを見直す）

- **判断を ADR 化せず migration 1 本だけで対応する**:
  「project 初期化時の暗黙状態に依存しない」という原則が明文化されないと、新規 table 追加時に
  同じ罠を踏みかねない。原則を ADR で固定することで判断のブレが減る。本 ADR を採用

## Notes

- 本 ADR を実装する初回 migration は `supabase/migrations/<timestamp>_grant_authenticated_to_public_tables.sql`。
  本 ADR 受理時点の全 public table への GRANT + `ALTER DEFAULT PRIVILEGES` を同一 migration で行う
- 本番への初回適用時は `\dp public.<table>` を pre / post で取り、no-op であることを確認する
  （ADR-0019 の手動 workflow に乗せて慎重さを保つ）
- 新規 table を追加する migration を書く時は、`ALTER DEFAULT PRIVILEGES` の効果で自動 GRANT
  される前提で良いが、明示的に `grant ... on public.<new_table> to authenticated;` を書いても
  idempotent なので構わない
- 将来 supersede される条件:
  - DB 自体を別サービス (Neon 等) に乗り換える場合
  - Supabase の権限 model が大きく変わり、`authenticated` ロール前提が崩れる場合
  - kozutsumi がアルファを抜けて他人のデータを預かるフェーズに入り、`anon` GRANT 方針 / RLS 前提が
    変わる場合
  - `column-level` / `function-level` GRANT を体系化する別 ADR がこれを内包する場合
