import { createAdminClient, ensureTestUser, purgeUserData, requiredEnv } from "./db";
import { getAllWorkerEmails } from "./users";

/**
 * e2e 共通 setup (ADR 0011)。
 *
 * 1. workers >1 化 (Issue #67 系の並列化) のため、N 人分の test user を
 *    idempotent に用意する (createUser または password 上書き)
 * 2. 各ユーザーの projects / tasks / events / action_logs を purge して
 *    clean state にする
 *
 * テストごとの purge は fixtures.ts (`signedInPage`) で重ねて行うため、
 * ここは defense-in-depth (CI 全体の最初の clean) と user 作成の両方を担う。
 */
async function globalSetup(): Promise<void> {
  const password = requiredEnv("E2E_TEST_USER_PASSWORD");
  const admin = createAdminClient();
  const emails = getAllWorkerEmails();

  await Promise.all(
    emails.map(async (email) => {
      const userId = await ensureTestUser(admin, email, password);
      await purgeUserData(admin, userId);
    }),
  );
}

export default globalSetup;
