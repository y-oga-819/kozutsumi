import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  Database,
  Tables,
  TablesInsert,
  TablesUpdate,
} from "@/shared/types/database";

import type {
  CreateEventInput,
  EventGateway,
  UpdateEventInput,
} from "./gateway";
import type { Event } from "./types";

type Sb = SupabaseClient<Database>;

function fromRow(row: Tables<"events">): Event {
  return {
    id: row.id,
    title: row.title,
    startTime: row.start_time,
    endTime: row.end_time,
    projectId: row.project_id,
    meetUrl: row.meet_url,
    hasAttachments: row.has_attachments,
    description: row.description,
    source: row.source,
    externalId: row.external_id,
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

export class SupabaseEventGateway implements EventGateway {
  constructor(private readonly supabase: Sb) {}

  async list(): Promise<Event[]> {
    const { data, error } = await this.supabase
      .from("events")
      .select("*")
      .order("start_time", { ascending: true });
    if (error) throw error;
    return (data ?? []).map(fromRow);
  }

  async create(input: CreateEventInput): Promise<Event> {
    const user_id = await getUserId(this.supabase);
    const payload: TablesInsert<"events"> = {
      user_id,
      title: input.title,
      start_time: input.startTime,
      end_time: input.endTime,
      project_id: input.projectId ?? null,
      meet_url: input.meetUrl ?? null,
      has_attachments: input.hasAttachments ?? false,
      description: input.description ?? "",
      source: input.source ?? "manual",
      external_id: input.externalId ?? null,
    };
    const { data, error } = await this.supabase
      .from("events")
      .insert(payload)
      .select("*")
      .single();
    if (error) throw error;
    return fromRow(data);
  }

  async update(id: string, patch: UpdateEventInput): Promise<Event> {
    const update: TablesUpdate<"events"> = {};
    if (patch.title !== undefined) update.title = patch.title;
    if (patch.startTime !== undefined) update.start_time = patch.startTime;
    if (patch.endTime !== undefined) update.end_time = patch.endTime;
    if (patch.projectId !== undefined) update.project_id = patch.projectId;
    if (patch.meetUrl !== undefined) update.meet_url = patch.meetUrl;
    if (patch.hasAttachments !== undefined)
      update.has_attachments = patch.hasAttachments;
    if (patch.description !== undefined) update.description = patch.description;
    const { data, error } = await this.supabase
      .from("events")
      .update(update)
      .eq("id", id)
      .select("*")
      .single();
    if (error) throw error;
    return fromRow(data);
  }

  async delete(id: string): Promise<void> {
    const { error } = await this.supabase.from("events").delete().eq("id", id);
    if (error) throw error;
  }

  async deleteAllForCurrentUser(): Promise<void> {
    const uid = await getUserId(this.supabase);
    const { error } = await this.supabase
      .from("events")
      .delete()
      .eq("user_id", uid);
    if (error) throw error;
  }
}
