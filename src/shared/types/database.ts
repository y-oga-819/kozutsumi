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
export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

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
          created_at?: string;
          completed_at?: string | null;
        };
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
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: {
      task_status: "idle" | "active" | "paused" | "done";
      event_source: "manual" | "google_calendar";
      pause_reason: "meeting" | "interruption" | "voluntary";
    };
  };
};

export type Tables<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Row"];
export type TablesInsert<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Insert"];
export type TablesUpdate<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Update"];
export type Enums<T extends keyof Database["public"]["Enums"]> =
  Database["public"]["Enums"][T];
