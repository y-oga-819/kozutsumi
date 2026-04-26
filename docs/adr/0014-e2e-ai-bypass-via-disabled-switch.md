# ADR 0014: e2e は `AI_ENABLED=false` で AI 経路をバイパスし、AI ロジックは別レイヤで保証する

- **Status**: Accepted
- **Date**: 2026-04-26
- **Related**: [ADR 0011](./0011-e2e-real-supabase-with-password-bypass.md) / [ADR 0012](./0012-ai-call-via-route-handler.md) / [ADR 0013](./0013-ai-as-augmentation-only.md)

## Context

ADR 0011 で e2e は「本物の Supabase ローカル + password sign-in による auth バイパス」で組んだ。同 ADR の見直し条件として「Phase 3 で AI モック設計が固まったら別 ADR にする」と残してあった。

Phase 3 で AI 呼び出し（ADR 0012）が入ると、e2e で以下の問題が生じる:

1. **LLM 応答は非決定的**。同じ prompt でも回答が揺れる。e2e のアサーションが flaky 化する。
2. **CI から Gemini API に出ていくと quota を消費する**。無料枠 (10 RPM / 250 req/day) を CI で食い潰すと開発が止まる。
3. **Gemini が落ちると CI も赤くなる**。kozutsumi の機能変更と無関係に CI が壊れる。

ADR 0013 で `AI_ENABLED` env switch を入れる判断をしているので、これを e2e でも流用すれば Route Handler 側で early return が効く。

## Decision

e2e は **`AI_ENABLED=false` で起動し、AI 経路を全面バイパスする**。

1. `playwright.config.ts` の `webServer.env` に `AI_ENABLED=false` を渡す。
2. すべての `/api/ai/*` Route Handler は ADR 0013 のとおり `AI_ENABLED !== "true"` のとき early return する（200 + 空 / no-op レスポンス）。e2e 専用の分岐は **作らない**。同じコードパスで本番 (off 設定) と e2e が動く。
3. e2e で確認するのは **「AI 経路が無くても core が壊れないこと」**。例:
   - タスク追加 → 分解結果が無くても 1 タスクだけ正常に挿入される
   - `task_category` が null のままでも Stack / Tree が描画される
   - 補正後見積もりが無くてもタイマー / 状態遷移は通常動作する
4. **AI ロジック自体は別レイヤ（ユニット / integration）で保証する**。Route Handler 内部の prompt 構築 / レスポンス parse / `action_log` 書き込み等は、純粋関数として切り出してユニットテストの対象にする。LLM 呼び出し境界はモック。
5. **AI 成功パスの統合確認は手動 / dev 環境**で行う。本物の Gemini に対して dev で叩く運用にする（CI に乗せない）。

## Consequences

### 肯定的影響

- **e2e の決定性が崩れない**。LLM 揺れに左右されない。
- **CI コストがゼロ**。Gemini quota を消費しない。
- **本番と e2e のコードパスが揃う**（ADR 0011 の「テスト用バイパスを最小化する」思想と整合）。Route Handler に `if (e2e) ...` のような専用分岐を入れない。
- **AI 機能の安全網が二段構えになる**。core path の不変条件は e2e、AI ロジック単体はユニット。責務が分離する。

### 否定的影響・トレードオフ

- **AI 経路の end-to-end は CI で踏めない**。Route Handler 〜 Gemini 〜 DB 書き込みの一気通貫は手動確認に委ねる。Phase 3 中に AI 経路の回帰が起きたら手動で気付く必要がある。許容するのは:
  - AI 機能は augmentation only (ADR 0013) なので、回帰しても core は止まらない
  - prompt 構築 / parse はユニットで踏める
- **AI ロジックの「切り出し」設計コストが発生する**。Route Handler 内に密結合で書くと unit がやりにくいので、ロジック層を意図的に分ける必要がある。
- **`AI_ENABLED` env を CI / playwright / Vercel preview / production で間違えるリスク**。デフォルトと設定箇所を明文化する必要がある（実装 issue 側）。

## Alternatives considered

- **MSW / nock で Gemini API をモック**: e2e で AI 経路を「呼ばれたフリ」させる。本物の Route Handler 内部ロジック（prompt 構築 / parse）まで踏めるのは魅力。だが mock 応答を保守する負担と、応答 schema 変更時の誤検知が増える。Route Handler 内ロジックはユニットで踏むので二重投資になる。不採用。
- **e2e 専用の AI stub Route Handler を別エンドポイントで用意**: 本番と別経路を作ると ADR 0011 の「本番コードパスを最大限通す」原則と矛盾する。不採用。
- **VCR (record / replay)**: 一度本物に叩いて応答を録画、以降は replay。LLM 応答変化に脆く、prompt が変わるたびに re-record が必要。Phase 3 のスコープに対して重すぎる。不採用。
- **e2e で AI を本物に叩く**: flaky / quota 問題の両方が露呈する。不採用。

## Notes

- `AI_ENABLED` の env 既定値・各環境設定は実装 issue で確定（ADR にしない）。
- AI 経路の手動確認手順は dev 用 README / CONTRIBUTING に書く想定。
- 将来「AI 成功パスも e2e で踏みたい」ニーズが出たら、本 ADR の見直し条件:
  - LLM の決定性が向上する（temperature 0 + seed 等で再現可能になる）
  - AI 出力が core path の必須前提になる（ADR 0013 を覆す）判断が出る
  - Route Handler 内ロジックがユニットで踏みきれない複雑度になる
- 本 ADR は ADR 0011 の見直し条件「AI モック設計が固まったら別 ADR にする」を消化するものでもある。ADR 0011 自体は supersede しない（auth バイパス判断は別軸）。
