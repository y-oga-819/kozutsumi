# ADR 0002: Google OAuth の calendar.readonly scope を Phase 1 で先行付与する

- **Status**: Accepted
- **Date**: 2026-04-15
- **Related**: `docs/design/architecture.md` §3 / Issue #24

## Context

Phase 1 は AIなし・カレンダー連携なし。認証は Supabase Auth + Google OAuth で実装するが、
Phase 1 の機能範囲では Google Calendar API を**使わない**。

一方、Phase 2 で Google Calendar 連携を開始する時、OAuth scope に `calendar.readonly`
が含まれていないと **再認証フロー**が発生する。ユーザー（= 著者自身）には「権限追加のため
ログインし直してください」という UX が挟まる。

Phase 1 の時点でどの scope を要求するか、という判断が必要。

## Decision

Phase 1 の OAuth 設定で `https://www.googleapis.com/auth/calendar.readonly` scope を
**先行付与する**。Phase 1 ではトークンは保持するだけで API は呼ばない。
Phase 2 で Google Calendar API を使い始める時、保存済みの `provider_token` /
`provider_refresh_token` をそのまま使う。

## Consequences

### 肯定的影響

- **Phase 2 移行時の再認証が不要**。著者は Phase 1 の期間中、継続的にツールを使い込む。
  その体験の途中で「権限追加のため再ログイン」という分断が入らない。
- Phase 2 の実装が軽くなる（OAuth フローの再設計が不要、API 呼び出しだけ追加）。

### 否定的影響・トレードオフ

- **Phase 1 時点で「使わない権限」を付与している**ように見える。個人用アプリで自分しか
  使わないため実害はないが、もし将来的に他人にも配る場合は「最小権限の原則」違反として
  感じる余地がある。
- トークンの保管コスト（Supabase Auth のセッション標準に従うので実務コストはほぼゼロ）。

Phase 1 時点でユーザーは著者本人のみ。上記トレードオフは許容範囲。

## Alternatives considered

- **Phase 2 で必要になった時に scope 追加**: 王道だが、再認証の UX 分断が発生。不採用。
- **Phase 1 から Calendar API を呼ぶ**: スコープ先行付与だけでなく実装も先取りする案。
  Phase 1 のスコープを超える上、カレンダー連携は Phase 2 の仮説検証対象なので、
  Phase 1 で仕込むと検証が汚れる。不採用。

## Notes

- トークンは Supabase Auth のセッション標準に従って保管。自前テーブルで控えない。
- 他の Google API scope（Gmail, Drive 等）は Phase 1 の時点では含めない。
  本プロジェクトの計画範囲 (Phase 1-4) では Calendar のみ使う想定。
