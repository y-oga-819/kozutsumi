import type { SupabaseClient } from "@supabase/supabase-js";

import type { EventSource } from "@/entities/event/types";
import type { Database, Tables } from "@/shared/types/database";

import type { ExternalAccountGateway } from "./gateway";
import type { ExternalAccount } from "./types";

type Sb = SupabaseClient<Database>;

function fromRow(row: Tables<"external_accounts">): ExternalAccount {
  return {
    id: row.id,
    source: row.source,
    externalAccountId: row.external_account_id,
    displayName: row.display_name,
    createdAt: row.created_at,
  };
}

export class SupabaseExternalAccountGateway implements ExternalAccountGateway {
  constructor(private readonly supabase: Sb) {}

  async list(source?: EventSource): Promise<ExternalAccount[]> {
    const query = this.supabase.from("external_accounts").select("*").order("created_at");
    const { data, error } = source ? await query.eq("source", source) : await query;
    if (error) throw error;
    return (data ?? []).map(fromRow);
  }
}
