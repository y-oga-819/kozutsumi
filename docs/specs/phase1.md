# kozutsumi Phase 1 実装指示

## 前提

- [../design/architecture.md](../design/architecture.md) / [../design/feature-spec.md](../design/feature-spec.md) を設計書として参照すること
- 個人用タスク管理Webアプリの Phase 1 を実装する
- Phase 1 は AIなし・カレンダー連携なし。手動でイベントとタスクを入力し、イベント駆動スタックの体験を検証する

## 技術スタック

- Next.js (App Router)
- Supabase (Postgres + Auth with Google OAuth)
- TypeScript
- Tailwind CSS

## Step 1: データモデル設計 + Supabase セットアップ

Phase 1 で必要なテーブルに加え、Phase 3-4 で必要になる行動ログのテーブルも Phase 1 の時点で仕込んでおく。行動ログは kozutsumi の差別化の核であり、後から追加するとデータの取りこぼしが発生するため。

### テーブル設計方針

**projects テーブル**
- id, user_id, name, color, is_primary (本業フラグ), created_at

**tasks テーブル**
- id, user_id, project_id, title, body (Markdown), estimated_minutes (ユーザー入力の見積もり分数), status (idle/active/paused/done), stack_order (スタック内の順序), depends_on_event_id (依存イベント、任意), is_interruption (割り込みフラグ), parent_task_id (AI分解の元タスク、Phase 3用), created_at, completed_at

**events テーブル**
- id, user_id, title, start_time, end_time, project_id (任意), meet_url (任意), has_attachments (boolean), description (Markdown), source (manual/google_calendar), external_id (Google Calendar連携用、Phase 2), created_at

**task_time_entries テーブル（作業時間記録）**
- id, task_id, started_at, paused_at, pause_reason (meeting/interruption/voluntary), duration_seconds

**action_logs テーブル（行動ログ、Phase 1から記録開始）**
- id, user_id, action_type, task_id (任意), metadata (JSONB), created_at

action_type の種類:
- task_started: タスク開始
- task_paused: タスク中断 (metadata に pause_reason)
- task_resumed: タスク再開
- task_completed: タスク完了 (metadata に estimated_minutes, actual_minutes)
- task_reordered: スタック並べ替え (metadata に from_position, to_position)
- task_deleted: タスク削除
- task_title_changed: タイトル変更 (metadata に old_title, new_title)
- interruption_pushed: 割り込みpush
- interruption_completed: 割り込み完了
- stack_proposed: AI提案のスタック (Phase 4用)
- stack_proposal_accepted: 提案承認 (Phase 4用)

RLS (Row Level Security) を全テーブルに設定し、user_id で制限する。

## Step 2: 認証

Google OAuth で Supabase Auth を使う。Phase 2 で Google Calendar API のトークンを再利用するため、OAuth スコープに calendar.readonly を含めておく（Phase 1 では使わないが、後からスコープ追加すると再認証が必要になるため）。

## Step 3: コアUI実装

[../design/feature-spec.md](../design/feature-spec.md) の「機能設計」に従い実装する。ローカルに UI プロトタイプがある場合はデザインの参考とするが、コードは流用せず Next.js + Tailwind で再構築する。

### Stack View（メイン画面）

1. **デイタイムライン**
   - 9:00-18:00 を基本、イベントがある場合は動的に伸びる
   - イベントはプロジェクト色のブロック、各ブロックに所要時間表示
   - 空き時間ブロックに所要時間表示
   - 現在時刻の緑マーカー

2. **イベントカード一覧**
   - 時系列カード表示
   - 添付資料アイコン、会議URLアイコン
   - NEXTイベントには会議参加ボタン
   - タップで詳細パネル（Markdown表示）

3. **タスクスタック**
   - トップタスクを大きなカードで表示
   - 2番目以降はコンパクトな1行
   - ドラッグ&ドロップで並べ替え（pointer events ベース、モバイル対応）
   - 完了ボタン（実作業時間を自動記録）
   - 割り込みpushボタン（⚡マーク）
   - タップで詳細パネル（Markdown プレビュー/エディタ切替）

4. **開始/中断/再開**
   - トップタスクに「開始」ボタン → active状態、タイマー表示
   - MTG開始時や割り込み時に自動 or 手動で paused
   - paused理由を選択（MTG/割り込み/自発的中断）

### Tree View（履歴画面）

- git log tree 風のUI
- 縦軸が時間、横軸がプロジェクト（色付き縦線）
- 完了タスクがノード
- 日付区切り

### 共通

- ヘッダーに Stack/Tree 切替タブ
- タスク追加フォーム（タイトル、プロジェクト選択、見積もり時間）
- イベント追加フォーム（タイトル、開始-終了時刻、会議URL、プロジェクト）
- プロジェクト管理（名前、色、本業フラグ）

## Step 4: 行動ログの記録

Phase 1 の段階から全ての操作を action_logs テーブルに記録する。UI上では見せないが、裏側で蓄積する。これが Phase 3-4 の学習データになる。

## 検証基準

Phase 1 の成功基準（[../design/feature-spec.md](../design/feature-spec.md) の「成功指標（KPI）」より）:
- スタックのトップから1個ずつ消化が7日間継続できるか
- 割り込みpush/popで元タスクに戻れた率80%以上
- タイムラインバーが空き時間の判断に役立つか
- 見積もり時間と実作業時間の記録が自然にできるか

## 注意事項

- モバイルファーストで実装する（max-width: 480px ベース）
- ダークテーマ固定（設計書の世界観に合わせる）
- Supabase のリアルタイム同期は Phase 1 では不要。通常のCRUDで十分
