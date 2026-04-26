import { requiredEnv } from "./db";

/**
 * e2e の per-worker test user 採番 (Issue #67 系の e2e 並列化)。
 *
 * Playwright の workers >1 で実行する場合、各 worker が同じ test user の
 * tasks/projects を購入&purge すると test 間で干渉する。worker ごとに別 user に
 * 分けることで、purge / login / DB assert の isolation を保つ。
 *
 * email 規則:
 *   base: `e2e@kozutsumi.local` (E2E_TEST_USER_EMAIL)
 *   per-worker: `e2e-w0@kozutsumi.local` / `e2e-w1@...` / ...
 *
 * `+` だと一部の Supabase auth 経路で展開される懸念があるので `-` で連結する。
 */
export const E2E_WORKER_COUNT = 4;

export function getWorkerEmail(baseEmail: string, workerIndex: number): string {
  const atIdx = baseEmail.indexOf("@");
  if (atIdx < 0) {
    throw new Error(`[e2e] invalid base email (no @): ${baseEmail}`);
  }
  const local = baseEmail.slice(0, atIdx);
  const domain = baseEmail.slice(atIdx + 1);
  return `${local}-w${workerIndex}@${domain}`;
}

export function getAllWorkerEmails(count: number = E2E_WORKER_COUNT): string[] {
  const baseEmail = requiredEnv("E2E_TEST_USER_EMAIL");
  return Array.from({ length: count }, (_, i) => getWorkerEmail(baseEmail, i));
}
