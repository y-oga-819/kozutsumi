export type ActionType =
  | "task_started"
  | "task_paused"
  | "task_resumed"
  | "task_completed"
  | "task_reordered"
  | "task_deleted"
  | "task_title_changed"
  | "task_category_changed"
  | "task_dependency_set"
  | "task_dependency_cleared"
  | "interruption_pushed"
  | "interruption_completed"
  | "stack_proposed"
  | "stack_proposal_accepted"
  | "calendar_synced"
  | "task_decomposed"
  | "task_decompose_failed"
  | "task_decompose_skipped"
  | "task_child_resplit"
  | "decomposition_modified"
  // ADR 0034 / 0035: calendar / event 関連 type (発火実装は #144 / #145 / #146)。
  // user actor:
  | "calendar_subscribed"
  | "calendar_unsubscribed"
  | "calendar_auto_promote_changed"
  | "event_promoted"
  | "event_demoted"
  | "event_override_cleared"
  | "external_account_added"
  | "external_account_removed"
  // system actor:
  | "event_visibility_frozen_by_subscription_toggle"
  | "event_deleted_by_source"
  | "task_event_dependency_lost"
  | "external_account_reauth_required";

/**
 * action_logs.actor_type の値域 (ADR 0035)。
 * DB は CHECK 制約を貼らない (ADR 0001) ので、型側で固定する。
 * 値追加 (将来 'ai' 等) は ADR 0035 の supersede ではなく追加判断として扱える。
 */
export type ActorType = "user" | "system";

/**
 * AI 分解の失敗種別 (ADR 0021)。詳細パネル (P3-15) で reason ごとに recovery 文言を出すため
 * 機械可読タグとして action_log に保存する。
 *
 * - quota_exhausted     : Gemini 429 / billing
 * - upstream_unavailable: network / 503 / timeout
 * - ai_response_unparseable: parser 失敗
 * - insert_failed       : 子 insert 失敗
 * - internal_error      : その他想定外 throw (last-resort safety net)
 */
export type DecomposeFailReason =
  | "quota_exhausted"
  | "upstream_unavailable"
  | "ai_response_unparseable"
  | "insert_failed"
  | "internal_error";

/**
 * `decomposition_modified.kind` の値域。Phase 3 ではこの 1 ACTION_TYPE で
 * 「分解後に親子関係が動いた」事象を総称的に拾い、kind で区別する。
 *
 * - child_deleted : 分解結果の子が削除された (= 分解粒度が細かすぎた示唆)
 * - child_edited  : 分解結果の子のタイトル / 見積もりが書き換えられた
 * - parent_merged : 親が削除されて子が孤児化した (= ADR 0018 の「親統合」)
 *
 * 「子の再分解」は ADR 0030 で独立した action_type `task_child_resplit` に切り出した
 * (metadata に snapshot / new_child_ids / raw_response を inline で持つ必要があり、
 *  decomposition_modified の薄い metadata 構造に乗せると型の一貫性が崩れるため)。
 */
export type DecompositionModifiedKind = "child_deleted" | "child_edited" | "parent_merged";

export type PauseReason = "meeting" | "interruption" | "voluntary";

/** Google Calendar 同期がどの経路でトリガーされたか。Phase 4 の頻度分析に使う (#51)。 */
export type CalendarSyncTrigger = "manual" | "lazy";

export type ActionMetadataMap = {
  task_started: { task_id: string };
  task_paused: { task_id: string; pause_reason: PauseReason };
  task_resumed: { task_id: string };
  task_completed: {
    task_id: string;
    estimated_minutes?: number;
    actual_minutes?: number;
  };
  task_reordered: {
    task_id: string;
    from_position: number;
    to_position: number;
  };
  // ADR 0035 §5: 削除系は元 entity が物理削除されるため snapshot を必須化する。
  // 過去ログ (snapshot 列が無かった頃) は backfill しない (ADR 0035 §6)。
  // Phase 4 の回避パターン分析: 「どんな未着手タスクが削除されたか」を再構成可能にする。
  task_deleted: {
    task_id: string;
    snapshot: {
      title: string;
      estimated_minutes: number | null;
      task_category: string | null;
      status: "idle" | "active" | "paused" | "done";
      parent_task_id: string | null;
    };
  };
  task_title_changed: {
    task_id: string;
    old_title: string;
    new_title: string;
  };
  // Phase 3 #87 / ADR 0015: 人間が AI 初期ラベル / 既存値を override した時に記録。
  // Phase 4 のラベリング精度改善ループの暗黙フィードバック源。
  // from は AI ラベリング失敗 / 既存タスクで null になり得る。to は user 選択値で必ず存在する。
  task_category_changed: {
    task_id: string;
    from: string | null;
    to: string;
  };
  // Phase 2 #53: 依存イベントの設定 / 解除。Phase 4 で「依存設定が着手順に効いたか」の分析データに使う。
  task_dependency_set: {
    task_id: string;
    event_id: string;
    was: string | null;
  };
  task_dependency_cleared: {
    task_id: string;
    was: string;
  };
  interruption_pushed: { task_id: string };
  interruption_completed: { task_id: string };
  stack_proposed: Record<string, unknown>;
  stack_proposal_accepted: Record<string, unknown>;
  calendar_synced: {
    synced: number;
    deleted: number;
    trigger: CalendarSyncTrigger;
  };
  // Phase 3 #88: AI 分解成功時、子作成と同時に記録 (ADR 0017 / 0018 / 0021)。
  // task_id は親 = 分解元タスク。child_ids は parent_task_id = task_id で
  // 紐づく子タスクの id 列で、Phase 4 の暗黙フィードバック分析の出発点になる。
  // raw_response (ADR 0021) は詳細パネルで折りたたみ表示する Gemini の生応答。
  task_decomposed: {
    task_id: string;
    child_ids: string[];
    raw_response: string;
  };
  // Phase 3 #111 / ADR 0021: AI 分解失敗時に reason と raw_response を残す。
  // raw_response は generate が応答を返した後に失敗した場合のみ存在する
  // (quota / network 等で generate 自体が throw した場合は無し)。
  task_decompose_failed: {
    task_id: string;
    reason: DecomposeFailReason;
    raw_response?: string;
    error_message?: string;
  };
  // Phase 3 #111 / ADR 0021: AI が「分解不要」と判断したケースを記録。
  // 詳細パネルで「AI が分解不要と判断」+ raw_response (判断理由) を表示する。
  task_decompose_skipped: {
    task_id: string;
    raw_response: string;
  };
  // ADR 0030 / Issue #121: 子タスクの再分解 (flatten) 時に発火。
  // task_id は新規子のうち先頭 (action_log の column 値、= 主体行)。
  // parent_id は元の親 (= flatten で配置先になる親)。
  // resplit_target_snapshot は削除直前の元の子の主要属性。Phase 4 の暗黙フィードバック
  // 分析で「ユーザーが粒度を変えた」シグナル + dangling task_id 解決のために inline で保存する。
  // new_child_ids は再分解で生まれた子 id 配列 (順序は stack_order 昇順)。
  // raw_response は Gemini の生応答 (詳細パネルの折りたたみ表示 / 学習素材)。
  task_child_resplit: {
    task_id: string;
    parent_id: string;
    resplit_target_snapshot: {
      id: string;
      title: string;
      body: string;
      estimated_minutes: number | null;
      task_category: string | null;
      // ADR 0038 / Issue #169: 主観サイズも snapshot に含めて再分解前後の比較を可能にする。
      // 既存タスク・未設定では null。
      task_size: string | null;
      created_at: string;
    };
    new_child_ids: string[];
    raw_response: string;
  };
  // Phase 3 #88: 分解後に親子関係が動いた事象の総称 (ADR 0018 Notes)。
  // task_id は当該イベントの主体 (削除された子 / 編集された子 / 削除された親)、
  // parent_id は分解元の親 id。kind で具体イベントを区別する。
  decomposition_modified: {
    task_id: string;
    parent_id: string;
    kind: DecompositionModifiedKind;
  };

  // ===== ADR 0035 §4: calendar / event 関連 type (発火実装は #144 / #145 / #146) =====
  //
  // 全てに共通の triple `(source, external_calendar_id, external_id)` を必須含める (ADR 0033)。
  // 削除系は snapshot 必須 (ADR 0035 §2 ii)。
  // event_promoted / event_demoted は `is_override_of_default` を Phase 4 学習素材として持つ。

  calendar_subscribed: {
    source: string;
    external_account_id: string;
    external_calendar_id: string;
    auto_promote_to_timeline: boolean;
  };
  calendar_unsubscribed: {
    source: string;
    external_account_id: string;
    external_calendar_id: string;
    deleted_events: Array<{
      external_id: string;
      title: string;
      start_time: string;
      end_time: string;
      visibility_override: "none" | "shown" | "hidden";
    }>;
  };
  calendar_auto_promote_changed: {
    source: string;
    external_account_id: string;
    external_calendar_id: string;
    from: boolean;
    to: boolean;
  };
  event_promoted: {
    source: string;
    external_account_id: string;
    external_calendar_id: string;
    external_id: string;
    from: "none" | "shown" | "hidden";
    to: "shown";
    subscription_auto_promote: boolean;
    is_override_of_default: boolean;
  };
  event_demoted: {
    source: string;
    external_account_id: string;
    external_calendar_id: string;
    external_id: string;
    from: "none" | "shown" | "hidden";
    to: "hidden";
    subscription_auto_promote: boolean;
    is_override_of_default: boolean;
  };
  event_override_cleared: {
    source: string;
    external_account_id: string;
    external_calendar_id: string;
    external_id: string;
    from: "shown" | "hidden";
    subscription_auto_promote: boolean;
  };
  external_account_added: {
    source: string;
    external_account_id: string;
    display_name: string | null;
  };
  external_account_removed: {
    source: string;
    external_account_id: string;
    display_name: string | null;
    cascaded_unsubscribes: Array<{
      external_calendar_id: string;
      deleted_events: Array<{
        external_id: string;
        title: string;
        start_time: string;
        end_time: string;
        visibility_override: "none" | "shown" | "hidden";
      }>;
    }>;
  };
  // system actor types
  event_visibility_frozen_by_subscription_toggle: {
    source: string;
    external_account_id: string;
    external_calendar_id: string;
    external_id: string;
    frozen_to: "shown" | "hidden";
    triggered_by: string;
  };
  event_deleted_by_source: {
    source: string;
    external_account_id: string;
    external_calendar_id: string;
    external_id: string;
    snapshot: {
      title: string;
      start_time: string;
      end_time: string;
      visibility_override: "none" | "shown" | "hidden";
    };
  };
  task_event_dependency_lost: {
    task_id: string;
    source: string;
    external_account_id: string;
    external_calendar_id: string;
    external_id: string;
    deletion_reason: "deleted_by_source" | "unsubscribed";
    event_snapshot: {
      title: string;
      start_time: string;
      end_time: string;
    };
  };
  external_account_reauth_required: {
    source: string;
    external_account_id: string;
    error_kind: string;
  };
};

export type ActionLogEntry<T extends ActionType = ActionType> = {
  action_type: T;
  metadata: ActionMetadataMap[T];
  created_at: string;
};
