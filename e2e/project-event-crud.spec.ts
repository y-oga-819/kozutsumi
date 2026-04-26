import { createAdminClient, getEventByTitle, getProjectByName, getTaskByTitle } from "./db";
import { expect, test } from "./fixtures";

/**
 * Issue #67 🟧:
 *   プロジェクト / manual イベント作成の DB 整合。
 *
 * golden-path / 他の spec はプロジェクトを使う側にしか居ないため、
 * `projects` / `events (source='manual')` 行が UI 入力通りに落ちることを
 * service_role で踏みにいく。
 *
 * Issue #75 で追加: プロジェクト編集 / 削除 + cascade (tasks.project_id /
 * events.project_id が `ON DELETE SET NULL` で null 化) も同 spec で踏む。
 *
 * **スコープアウト** (現状コードに UI が無い):
 *   - manual イベントの編集 / 削除 UI (EventDetailPanel に未実装、
 *     EventDetailPanel.test の「どの source でも『削除』ボタンは表示されない」
 *     と整合)。
 *   実装が入った段階で本 spec を拡張する。
 */
test.describe("プロジェクト作成 (projects 行整合)", () => {
  test("名前 / 色 / 本業フラグ が projects 行に正しく落ちる", async ({
    signedInPage: page,
    testUserId: userId,
  }) => {
    const projectName = "本業プロジェクト";
    const projectColor = "#0096C7"; // ProjectForm DEFAULT_COLORS の 2 番目

    const admin = createAdminClient();

    await page.getByRole("button", { name: "新規追加" }).click();
    const addDialog = page.getByRole("dialog", { name: "追加メニュー" });
    await addDialog.getByRole("tab", { name: "プロジェクト" }).click();
    await addDialog.getByLabel("名前").fill(projectName);
    // 色ボタンは `aria-label={色}` で取れる (ProjectForm.tsx)。
    await addDialog.getByRole("button", { name: projectColor }).click();
    await addDialog.getByRole("checkbox", { name: "本業として扱う" }).check();
    await addDialog.getByRole("button", { name: "追加" }).click();
    await expect(addDialog).toHaveCount(0);

    const project = await getProjectByName(admin, userId, projectName);
    expect(project.name).toBe(projectName);
    expect(project.color).toBe(projectColor);
    expect(project.is_primary).toBe(true);
    expect(project.user_id).toBe(userId);
  });
});

test.describe("manual イベント作成 (events 行整合)", () => {
  test("title / start_time / end_time / meet_url / project / source=manual で events 行に落ちる", async ({
    signedInPageWithProject: page,
    projectName,
    testUserId: userId,
  }) => {
    const eventTitle = "E2E SLO レビュー MTG";
    const startLocal = "2030-06-15T13:00";
    const endLocal = "2030-06-15T14:00";
    const meetUrl = "https://meet.google.com/e2e-slo-review";

    const admin = createAdminClient();

    const project = await getProjectByName(admin, userId, projectName);

    await page.getByRole("button", { name: "新規追加" }).click();
    const addDialog = page.getByRole("dialog", { name: "追加メニュー" });
    await addDialog.getByRole("tab", { name: "イベント" }).click();
    await addDialog.getByLabel("タイトル").fill(eventTitle);
    // datetime-local は string で fill する (Playwright は ISO ローカルを受け付ける)。
    await addDialog.getByLabel("開始").fill(startLocal);
    await addDialog.getByLabel("終了").fill(endLocal);
    await addDialog.getByLabel("プロジェクト (任意)").selectOption({ label: projectName });
    await addDialog.getByLabel("会議URL (任意)").fill(meetUrl);
    await addDialog.getByRole("button", { name: "追加" }).click();
    await expect(addDialog).toHaveCount(0);

    const ev = await getEventByTitle(admin, userId, eventTitle);
    expect(ev.title).toBe(eventTitle);
    expect(ev.source).toBe("manual");
    expect(ev.external_id).toBeNull();
    expect(ev.project_id).toBe(project.id);
    expect(ev.meet_url).toBe(meetUrl);
    expect(ev.has_attachments).toBe(false);
    expect(ev.description).toBe("");

    // datetime-local はローカル tz で送信され DB に timestamptz として保存される。
    // tz 環境差で文字列比較は壊れやすいので、エポック ms に揃えて比較する。
    // EventForm: `${startLocal}:00` を渡すので "2030-06-15T13:00:00" 相当。
    expect(new Date(ev.start_time).getTime()).toBe(new Date(`${startLocal}:00`).getTime());
    expect(new Date(ev.end_time).getTime()).toBe(new Date(`${endLocal}:00`).getTime());
  });

  test("プロジェクト / 会議URL を空のままでも events 行が作れる", async ({
    signedInPage: page,
    testUserId: userId,
  }) => {
    const eventTitle = "E2E 任意項目なしイベント";
    const startLocal = "2030-07-01T09:00";
    const endLocal = "2030-07-01T10:00";

    const admin = createAdminClient();

    await page.getByRole("button", { name: "新規追加" }).click();
    const addDialog = page.getByRole("dialog", { name: "追加メニュー" });
    await addDialog.getByRole("tab", { name: "イベント" }).click();
    await addDialog.getByLabel("タイトル").fill(eventTitle);
    await addDialog.getByLabel("開始").fill(startLocal);
    await addDialog.getByLabel("終了").fill(endLocal);
    await addDialog.getByRole("button", { name: "追加" }).click();
    await expect(addDialog).toHaveCount(0);

    const ev = await getEventByTitle(admin, userId, eventTitle);
    expect(ev.source).toBe("manual");
    expect(ev.project_id).toBeNull();
    expect(ev.meet_url).toBeNull();
  });
});

test.describe("プロジェクト編集 (projects 行整合)", () => {
  test("名前 / 色 / 本業フラグ を編集すると projects 行に反映される", async ({
    signedInPageWithProject: page,
    projectName,
    testUserId: userId,
  }) => {
    const newName = "E2E 編集後プロジェクト";
    const newColor = "#0096C7";

    const admin = createAdminClient();

    await page.getByRole("button", { name: "新規追加" }).click();
    const addDialog = page.getByRole("dialog", { name: "追加メニュー" });
    await addDialog.getByRole("tab", { name: "プロジェクト" }).click();
    await addDialog.getByRole("button", { name: `${projectName} を編集` }).click();

    const editDialog = page.getByRole("dialog", { name: "プロジェクト編集" });
    await expect(editDialog).toBeVisible();

    await editDialog.getByLabel("名前").fill(newName);
    await editDialog.getByRole("button", { name: newColor }).click();
    await editDialog.getByRole("checkbox", { name: "本業として扱う" }).check();
    await editDialog.getByRole("button", { name: "保存" }).click();
    await expect(editDialog).toHaveCount(0);

    const project = await getProjectByName(admin, userId, newName);
    expect(project.name).toBe(newName);
    expect(project.color).toBe(newColor);
    expect(project.is_primary).toBe(true);
    expect(project.user_id).toBe(userId);
  });
});

test.describe("プロジェクト削除 (cascade SET NULL)", () => {
  test("削除すると projects 行が消え、紐付くタスク / イベント の project_id が null になる", async ({
    signedInPageWithProject: page,
    projectName,
    testUserId: userId,
  }) => {
    const admin = createAdminClient();
    const project = await getProjectByName(admin, userId, projectName);

    // 1. プロジェクトに紐付くタスクを 1 件作る
    const taskTitle = "E2E 削除前のタスク";
    await page.getByRole("button", { name: "新規追加" }).click();
    let addDialog = page.getByRole("dialog", { name: "追加メニュー" });
    await addDialog.getByLabel("タイトル").fill(taskTitle);
    await addDialog
      .getByLabel("プロジェクト", { exact: true })
      .selectOption({ label: projectName });
    await addDialog.getByRole("button", { name: "追加" }).click();
    await expect(addDialog).toHaveCount(0);

    // 2. プロジェクトに紐付く manual イベントを 1 件作る
    const eventTitle = "E2E 削除前のイベント";
    await page.getByRole("button", { name: "新規追加" }).click();
    addDialog = page.getByRole("dialog", { name: "追加メニュー" });
    await addDialog.getByRole("tab", { name: "イベント" }).click();
    await addDialog.getByLabel("タイトル").fill(eventTitle);
    await addDialog.getByLabel("開始").fill("2030-08-01T10:00");
    await addDialog.getByLabel("終了").fill("2030-08-01T11:00");
    await addDialog.getByLabel("プロジェクト (任意)").selectOption({ label: projectName });
    await addDialog.getByRole("button", { name: "追加" }).click();
    await expect(addDialog).toHaveCount(0);

    // 3. プロジェクトを削除 (window.confirm を accept)
    await page.getByRole("button", { name: "新規追加" }).click();
    addDialog = page.getByRole("dialog", { name: "追加メニュー" });
    await addDialog.getByRole("tab", { name: "プロジェクト" }).click();
    await addDialog.getByRole("button", { name: `${projectName} を編集` }).click();

    const editDialog = page.getByRole("dialog", { name: "プロジェクト編集" });
    await expect(editDialog).toBeVisible();

    page.once("dialog", (dialog) => dialog.accept());
    await editDialog.getByRole("button", { name: "削除" }).click();
    await expect(editDialog).toHaveCount(0);

    // 4. DB 検証
    // - projects 行が消えている
    const { data: remaining, error } = await admin
      .from("projects")
      .select("*")
      .eq("id", project.id);
    expect(error).toBeNull();
    expect(remaining).toEqual([]);

    // - tasks.project_id が null になっている (cascade SET NULL)
    const task = await getTaskByTitle(admin, userId, taskTitle);
    expect(task.project_id).toBeNull();

    // - events.project_id が null になっている (cascade SET NULL)
    const ev = await getEventByTitle(admin, userId, eventTitle);
    expect(ev.project_id).toBeNull();
  });
});
