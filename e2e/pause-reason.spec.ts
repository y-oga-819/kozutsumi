import type { Page } from "@playwright/test";

import {
  assertTimeEntriesInvariants,
  createAdminClient,
  expectTaskStatus,
  getTaskByTitle,
  waitForActionLog,
  waitForTimeEntries,
} from "./db";
import { expect, test } from "./fixtures";

/**
 * Issue #67 🟧 / ADR 0001 / ADR 0004:
 *   中断理由 3 種 (meeting / interruption / voluntary) のすべてが
 *   action_log と task_time_entries.pause_reason に正しく落ちることを踏む。
 *
 * voluntary は action-log-time-entry.spec で既にカバー済み。
 * 残り 2 つ (meeting / interruption) を data-driven で踏む。
 * Phase 4 で「割り込みの多い時間帯 / MTG 後のリカバリ」を分析するために、
 * pause_reason の分布が DB に正確に書かれていることが前提条件になる。
 */
type PauseCase = {
  reason: "meeting" | "interruption";
  buttonName: RegExp;
};

const CASES: readonly PauseCase[] = [
  { reason: "meeting", buttonName: /MTG/ },
  { reason: "interruption", buttonName: /割り込み/ },
] as const;

test.describe("中断理由の網羅 (action_log.pause_reason / time_entries.pause_reason)", () => {
  for (const c of CASES) {
    test(`pause_reason=${c.reason} で中断すると DB に同じ値が入る`, async ({
      signedInPageWithProject: page,
      projectName,
      testUserId: userId,
    }) => {
      const taskTitle = `中断理由テスト (${c.reason})`;
      const admin = createAdminClient();

      await createTask(page, taskTitle, projectName);
      const task = await getTaskByTitle(admin, userId, taskTitle);
      const taskId = task.id;

      // start
      await page.getByRole("button", { name: "開始" }).click();
      await expect(page.getByRole("button", { name: "中断" })).toBeVisible();
      await expectTaskStatus(admin, taskId, "active");

      // pause: 該当の理由ボタンを押す
      await page.getByRole("button", { name: "中断" }).click();
      const pauseDialog = page.getByRole("dialog", { name: "中断の理由" });
      await pauseDialog.getByRole("button", { name: c.buttonName }).click();

      await expect(page.getByRole("button", { name: "再開" })).toBeVisible();
      await expectTaskStatus(admin, taskId, "paused");

      // action_log: pause_reason が metadata に正しく入る
      const pausedLog = await waitForActionLog(
        admin,
        userId,
        (l) =>
          l.action_type === "task_paused" &&
          l.task_id === taskId &&
          (l.metadata as { pause_reason?: string }).pause_reason === c.reason,
        { description: `task_paused log with pause_reason=${c.reason}` },
      );
      expect((pausedLog.metadata as { pause_reason?: string }).pause_reason).toBe(c.reason);

      // task_time_entries: 直近 entry が close され pause_reason が一致
      const entries = await waitForTimeEntries(
        admin,
        taskId,
        (es) => es.length === 1 && es[0].paused_at !== null,
        { description: "entry closed after pause" },
      );
      assertTimeEntriesInvariants(entries);
      expect(entries[0].pause_reason).toBe(c.reason);
      expect(entries[0].duration_seconds).not.toBeNull();
    });
  }
});

async function createTask(page: Page, title: string, projectName: string): Promise<void> {
  await page.getByRole("button", { name: "新規追加" }).click();
  const addDialog = page.getByRole("dialog", { name: "追加メニュー" });
  await addDialog.getByRole("tab", { name: "タスク" }).click();
  await addDialog.getByLabel("タイトル").fill(title);
  // #170 / ADR 0038: task_size は登録時必須。
  await addDialog.getByRole("radio", { name: "30分" }).click();
  await addDialog.getByLabel("プロジェクト (任意)").selectOption({ label: projectName });
  await addDialog.getByRole("button", { name: "追加" }).click();
  await expect(addDialog).toHaveCount(0);
}
