import type { EventSource } from "@/entities/event/types";

import type { ExternalAccount } from "./types";

/**
 * 外部 calendar account の Gateway (ADR 0033 source-agnostic)。
 *
 * Phase 2 までは「primary 1 account 固定」が前提だったため `external_accounts` 行は
 * sync.ts の lazy upsert で生成していた。Issue #144 で複数 calendar / Issue #146 で
 * 複数 account に拡張するための読み取り経路を提供する。
 *
 * 書き込み (新規 OAuth account の追加 / 削除) は #146 のスコープなので、本 issue では
 * primary 1 行を read するだけの最小インターフェースに留める。
 */
export interface ExternalAccountGateway {
  /** 認証済 user の external_accounts (source 指定で絞れる)。 */
  list(source?: EventSource): Promise<ExternalAccount[]>;
}
