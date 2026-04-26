import { createAdminClient, getEventByTitle, getProjectByName } from "./db";
import { expect, test } from "./fixtures";

/**
 * Issue #67 🟧:
 *   プロジェクト / manual イベント作成の DB 整合。
 *
 * golden-path / 他の spec はプロジェクトを使う側にしか居ないため、
 * `projects` / `events (source='manual')` 行が UI 入力通りに落ちることを
 * service_role で踏みにいく。
 *
 * **スコープアウト** (現状コードに UI が無い):
 *   - manual イベントの編集 / 削除 UI (EventDetailPanel に未実装、
 *     EventDetailPanel.test の「どの source でも『削除』ボタンは表示されない」
 *     と整合)。
 *   - ProjectForm 経由の編集 / 削除 (該当 UI なし)。
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
