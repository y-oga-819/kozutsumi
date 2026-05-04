import type { EventSource } from "@/entities/event/types";

/**
 * 外部 calendar source 上のアカウント (ADR 0033 source-agnostic 命名)。
 *
 * `externalAccountId` は source 内でアカウントを一意に識別する文字列
 * (Google なら email or google_user_id)。`id` は kozutsumi 内 uuid。
 *
 * Google OAuth 用列 (refresh_token / access_token / scopes 等) は #146 で別途追加されるため、
 * 本 entity は最小プロファイル情報のみ扱う (#159 / ADR 0033)。
 */
export type ExternalAccount = {
  id: string;
  source: EventSource;
  externalAccountId: string;
  displayName: string | null;
  createdAt: string;
};
