/**
 * Supabase データベース型定義
 *
 * 本来は `supabase gen types typescript --local > src/shared/types/database.ts`
 * で自動生成する。Phase 1 時点ではローカル Supabase が立ち上がっていない環境でも
 * 型チェックを通せるよう、生成物と互換の形で手書きしている。
 *
 * Supabase プロジェクト起動後は上記コマンドで置き換えること (phase1.md Step 1.4)。
 *
 * スキーマ参照: supabase/migrations/20260419000000_initial_schema.sql
 */
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

/**
 * tasks.task_category の値域 (#87, ADR 0015)。
 * DB 側は text + CHECK 制約 (supabase/migrations/20260427000000_task_category.sql)。
 * 値の追加・名称変更は ADR の supersede ではなく migration + ここの更新で行う。
 *
 * 配列は AI 応答 parser (P3-4) など runtime で値域チェックする箇所で再利用する
 * 単一の真実の場所。type は配列から導出して二重管理を避ける。
 */
export const TASK_CATEGORY_VALUES = ["coding", "doc", "research", "admin", "other"] as const;
export type TaskCategoryValue = (typeof TASK_CATEGORY_VALUES)[number];

export type Database = {
  public: {
    Tables: {
      projects: {
        Row: {
          id: string;
          user_id: string;
          name: string;
          color: string;
          is_primary: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          name: string;
          color: string;
          is_primary?: boolean;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          name?: string;
          color?: string;
          is_primary?: boolean;
          created_at?: string;
        };
        Relationships: [];
      };
      tasks: {
        Row: {
          id: string;
          user_id: string;
          project_id: string | null;
          title: string;
          body: string;
          estimated_minutes: number | null;
          status: Database["public"]["Enums"]["task_status"];
          stack_order: number | null;
          depends_on_event_id: string | null;
          is_interruption: boolean;
          parent_task_id: string | null;
          decompose_status: Database["public"]["Enums"]["decompose_status"];
          task_category: TaskCategoryValue | null;
          created_at: string;
          completed_at: string | null;
        };
        Insert: {
          id?: string;
          user_id: string;
          project_id?: string | null;
          title: string;
          body?: string;
          estimated_minutes?: number | null;
          status?: Database["public"]["Enums"]["task_status"];
          stack_order?: number | null;
          depends_on_event_id?: string | null;
          is_interruption?: boolean;
          parent_task_id?: string | null;
          decompose_status?: Database["public"]["Enums"]["decompose_status"];
          task_category?: TaskCategoryValue | null;
          created_at?: string;
          completed_at?: string | null;
        };
        Update: {
          id?: string;
          user_id?: string;
          project_id?: string | null;
          title?: string;
          body?: string;
          estimated_minutes?: number | null;
          status?: Database["public"]["Enums"]["task_status"];
          stack_order?: number | null;
          depends_on_event_id?: string | null;
          is_interruption?: boolean;
          parent_task_id?: string | null;
          decompose_status?: Database["public"]["Enums"]["decompose_status"];
          task_category?: TaskCategoryValue | null;
          created_at?: string;
          completed_at?: string | null;
        };
        Relationships: [];
      };
      events: {
        Row: {
          id: string;
          user_id: string;
          title: string;
          start_time: string;
          end_time: string;
          project_id: string | null;
          meet_url: string | null;
          has_attachments: boolean;
          description: string;
          source: Database["public"]["Enums"]["event_source"];
          external_id: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          title: string;
          start_time: string;
          end_time: string;
          project_id?: string | null;
          meet_url?: string | null;
          has_attachments?: boolean;
          description?: string;
          source?: Database["public"]["Enums"]["event_source"];
          external_id?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          title?: string;
          start_time?: string;
          end_time?: string;
          project_id?: string | null;
          meet_url?: string | null;
          has_attachments?: boolean;
          description?: string;
          source?: Database["public"]["Enums"]["event_source"];
          external_id?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      task_time_entries: {
        Row: {
          id: string;
          task_id: string;
          started_at: string;
          paused_at: string | null;
          pause_reason: Database["public"]["Enums"]["pause_reason"] | null;
          duration_seconds: number | null;
        };
        Insert: {
          id?: string;
          task_id: string;
          started_at: string;
          paused_at?: string | null;
          pause_reason?: Database["public"]["Enums"]["pause_reason"] | null;
          duration_seconds?: number | null;
        };
        Update: {
          id?: string;
          task_id?: string;
          started_at?: string;
          paused_at?: string | null;
          pause_reason?: Database["public"]["Enums"]["pause_reason"] | null;
          duration_seconds?: number | null;
        };
        Relationships: [];
      };
      action_logs: {
        Row: {
          id: string;
          user_id: string;
          action_type: string;
          task_id: string | null;
          metadata: Json;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          action_type: string;
          task_id?: string | null;
          metadata?: Json;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          action_type?: string;
          task_id?: string | null;
          metadata?: Json;
          created_at?: string;
        };
        Relationships: [];
      };
      user_calendar_sync_state: {
        Row: {
          user_id: string;
          last_synced_at: string;
          sync_token: string | null;
          updated_at: string;
        };
        Insert: {
          user_id: string;
          last_synced_at: string;
          sync_token?: string | null;
          updated_at?: string;
        };
        Update: {
          user_id?: string;
          last_synced_at?: string;
          sync_token?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
    };
    Views: {
      task_actual_minutes: {
        Row: {
          task_id: string;
          user_id: string;
          task_category: TaskCategoryValue | null;
          status: "idle" | "active" | "paused" | "done";
          estimated_minutes: number | null;
          actual_minutes: number;
        };
        Relationships: [];
      };
      task_category_correction_factors: {
        Row: {
          user_id: string;
          task_category: TaskCategoryValue;
          sample_count: number;
          factor: number;
        };
        Relationships: [];
      };
    };
    Functions: {
      // ADR 0027 / 0028 / Issue #121: 子タスクの再分解 flatten 用 PL/pgSQL function。
      // delete 元の子 + insert 新規子 + 後続兄弟の stack_order シフトを 1 トランザクションで行う。
      // 戻り値は新規子の id 配列 (jsonb 入力順 = stack_order 昇順)。
      fn_resplit_child_task: {
        Args: {
          p_target_id: string;
          p_parent_id: string;
          p_base_stack_order: number;
          p_shift_amount: number;
          p_new_children: Json;
        };
        Returns: string[];
      };
    };
    Enums: {
      task_status: "idle" | "active" | "paused" | "done";
      event_source: "manual" | "google_calendar";
      pause_reason: "meeting" | "interruption" | "voluntary";
      decompose_status: "none" | "decomposing" | "decomposed" | "skipped" | "failed";
    };
  };
};

export type Tables<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Row"];
export type TablesInsert<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Insert"];
export type TablesUpdate<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Update"];
export type Views<T extends keyof Database["public"]["Views"]> =
  Database["public"]["Views"][T]["Row"];
export type Enums<T extends keyof Database["public"]["Enums"]> = Database["public"]["Enums"][T];
