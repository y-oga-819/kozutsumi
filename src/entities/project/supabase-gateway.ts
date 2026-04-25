import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database, Tables, TablesInsert, TablesUpdate } from "@/shared/types/database";

import type { CreateProjectInput, ProjectGateway, UpdateProjectInput } from "./gateway";
import type { Project } from "./types";

type Sb = SupabaseClient<Database>;

function fromRow(row: Tables<"projects">): Project {
  return {
    id: row.id,
    name: row.name,
    color: row.color,
    isPrimary: row.is_primary,
    createdAt: row.created_at,
  };
}

async function getUserId(supabase: Sb): Promise<string> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("not authenticated");
  return user.id;
}

export class SupabaseProjectGateway implements ProjectGateway {
  constructor(private readonly supabase: Sb) {}

  async list(): Promise<Project[]> {
    const { data, error } = await this.supabase
      .from("projects")
      .select("*")
      .order("created_at", { ascending: true });
    if (error) throw error;
    return (data ?? []).map(fromRow);
  }

  async create(input: CreateProjectInput): Promise<Project> {
    const user_id = await getUserId(this.supabase);
    const payload: TablesInsert<"projects"> = {
      user_id,
      name: input.name,
      color: input.color,
      is_primary: input.isPrimary ?? false,
    };
    const { data, error } = await this.supabase
      .from("projects")
      .insert(payload)
      .select("*")
      .single();
    if (error) throw error;
    return fromRow(data);
  }

  async update(id: string, patch: UpdateProjectInput): Promise<Project> {
    const update: TablesUpdate<"projects"> = {};
    if (patch.name !== undefined) update.name = patch.name;
    if (patch.color !== undefined) update.color = patch.color;
    if (patch.isPrimary !== undefined) update.is_primary = patch.isPrimary;
    const { data, error } = await this.supabase
      .from("projects")
      .update(update)
      .eq("id", id)
      .select("*")
      .single();
    if (error) throw error;
    return fromRow(data);
  }

  async delete(id: string): Promise<void> {
    const { error } = await this.supabase.from("projects").delete().eq("id", id);
    if (error) throw error;
  }

  async deleteAllForCurrentUser(): Promise<void> {
    const uid = await getUserId(this.supabase);
    const { error } = await this.supabase.from("projects").delete().eq("user_id", uid);
    if (error) throw error;
  }
}
