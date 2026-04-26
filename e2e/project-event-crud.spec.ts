import { createAdminClient, getEventByTitle, getProjectByName, getTaskByTitle } from "./db";
import { expect, test } from "./fixtures";

/**
 * Issue #67 🟧 / Issue #76:
 *   プロジェクト / manual イベントの create / edit / delete DB 整合。
 *
 * golden-path / 他の spec はプロジェクトを使う側にしか居ないため、
 * `projects` / `events (source='manual')` 行が UI 入力通りに落ちることを
 * service_role で踏みにいく。
 *
 * Issue #75 で追加: プロジェクト編集 / 削除 + cascade (tasks.project_id /
 * events.project_id が `ON DELETE SET NULL` で null 化) も同 spec で踏む。
 *
 * Issue #76 で追加: manual イベントの編集 / 削除 UI (`EventDetailPanel`)。
 * google_calendar 側の read-only 制約 (ADR 0010) は `gcal-event-readonly.spec.ts`
 * 側で踏んでいる。
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

test.describe("manual イベント編集 (events 行整合, Issue #76)", () => {
  test("title / 時刻 / プロジェクト / Meet URL / 本文 を編集すると events 行に反映される", async ({
    signedInPageWithProject: page,
    projectName,
    testUserId: userId,
  }) => {
    const initialTitle = "E2E 編集前 MTG";
    const newTitle = "E2E 編集後 MTG";
    const newBody = "## 議題\n- 編集テスト";
    const newMeetUrl = "https://meet.google.com/edited-e2e";
    // DayTimeline は「今日」のイベントしか描画しないので、開始日付は今日にする。
    const todayLocal = todayDateStr();
    const startLocal = `${todayLocal}T13:00`;
    const endLocal = `${todayLocal}T14:00`;
    const editedStartLocal = `${todayLocal}T15:00`;
    const editedEndLocal = `${todayLocal}T16:30`;

    const admin = createAdminClient();
    const project = await getProjectByName(admin, userId, projectName);

    // --- create: AddPanel から initialTitle / project なし / Meet URL なしで ---
    await page.getByRole("button", { name: "新規追加" }).click();
    let addDialog = page.getByRole("dialog", { name: "追加メニュー" });
    await addDialog.getByRole("tab", { name: "イベント" }).click();
    await addDialog.getByLabel("タイトル").fill(initialTitle);
    await addDialog.getByLabel("開始").fill(startLocal);
    await addDialog.getByLabel("終了").fill(endLocal);
    await addDialog.getByRole("button", { name: "追加" }).click();
    await expect(addDialog).toHaveCount(0);

    const created = await getEventByTitle(admin, userId, initialTitle);
    expect(created.project_id).toBeNull();
    expect(created.meet_url).toBeNull();
    expect(created.description).toBe("");

    // --- open EventDetailPanel: DayTimeline 上の event card をクリック ---
    await page.getByText(initialTitle).first().click();
    const detailDialog = page.getByRole("dialog", { name: "イベント詳細" });
    await expect(detailDialog).toBeVisible();

    // --- edit: 「編集」 → form 表示 → 全フィールド書き換え → 保存 ---
    await detailDialog.getByRole("button", { name: "編集" }).click();
    await detailDialog.getByLabel("タイトル").fill(newTitle);
    await detailDialog.getByLabel("開始").fill(editedStartLocal);
    await detailDialog.getByLabel("終了").fill(editedEndLocal);
    await detailDialog.getByLabel("プロジェクト (任意)").selectOption({ label: projectName });
    await detailDialog.getByLabel("会議URL (任意)").fill(newMeetUrl);
    await detailDialog.getByLabel("本文 (任意, Markdown)").fill(newBody);
    await detailDialog.getByRole("button", { name: "保存" }).click();

    // --- 保存後はパネルが view モードに戻る (form input が消える) ---
    await expect(detailDialog.getByLabel("タイトル")).toHaveCount(0);

    // --- DB 検証 ---
    // title が変わっているので getEventByTitle(newTitle) で取り直す。
    await expect
      .poll(async () => (await getEventByTitle(admin, userId, newTitle)).title, {
        message: "events.title should be updated",
        timeout: 5_000,
      })
      .toBe(newTitle);
    const after = await getEventByTitle(admin, userId, newTitle);
    expect(after.id).toBe(created.id);
    expect(after.source).toBe("manual");
    expect(after.project_id).toBe(project.id);
    expect(after.meet_url).toBe(newMeetUrl);
    expect(after.description).toBe(newBody);
    expect(new Date(after.start_time).getTime()).toBe(new Date(`${editedStartLocal}:00`).getTime());
    expect(new Date(after.end_time).getTime()).toBe(new Date(`${editedEndLocal}:00`).getTime());
  });
});

test.describe("manual イベント削除 (events 行消滅, Issue #76)", () => {
  test("削除ボタン → 確認 OK で events 行が消える", async ({
    signedInPage: page,
    testUserId: userId,
  }) => {
    const eventTitle = "E2E 削除対象イベント";
    const todayLocal = todayDateStr();
    const startLocal = `${todayLocal}T11:00`;
    const endLocal = `${todayLocal}T12:00`;

    const admin = createAdminClient();

    // --- create ---
    await page.getByRole("button", { name: "新規追加" }).click();
    const addDialog = page.getByRole("dialog", { name: "追加メニュー" });
    await addDialog.getByRole("tab", { name: "イベント" }).click();
    await addDialog.getByLabel("タイトル").fill(eventTitle);
    await addDialog.getByLabel("開始").fill(startLocal);
    await addDialog.getByLabel("終了").fill(endLocal);
    await addDialog.getByRole("button", { name: "追加" }).click();
    await expect(addDialog).toHaveCount(0);

    const created = await getEventByTitle(admin, userId, eventTitle);

    // --- open detail → 削除 (confirm を accept) ---
    await page.getByText(eventTitle).first().click();
    const detailDialog = page.getByRole("dialog", { name: "イベント詳細" });
    await expect(detailDialog).toBeVisible();

    page.once("dialog", (dialog) => dialog.accept());
    await detailDialog.getByRole("button", { name: "削除" }).click();
    await expect(detailDialog).toHaveCount(0);

    // --- DB: events 行が消えている ---
    await expect
      .poll(
        async () => {
          const { data } = await admin.from("events").select("id").eq("id", created.id);
          return data?.length ?? -1;
        },
        { message: "events row should be deleted", timeout: 5_000 },
      )
      .toBe(0);
  });

  test("確認ダイアログをキャンセルすると events 行は残る", async ({
    signedInPage: page,
    testUserId: userId,
  }) => {
    const eventTitle = "E2E 削除キャンセル対象";
    const todayLocal = todayDateStr();
    const startLocal = `${todayLocal}T08:00`;
    const endLocal = `${todayLocal}T09:00`;

    const admin = createAdminClient();

    await page.getByRole("button", { name: "新規追加" }).click();
    const addDialog = page.getByRole("dialog", { name: "追加メニュー" });
    await addDialog.getByRole("tab", { name: "イベント" }).click();
    await addDialog.getByLabel("タイトル").fill(eventTitle);
    await addDialog.getByLabel("開始").fill(startLocal);
    await addDialog.getByLabel("終了").fill(endLocal);
    await addDialog.getByRole("button", { name: "追加" }).click();
    await expect(addDialog).toHaveCount(0);

    const created = await getEventByTitle(admin, userId, eventTitle);

    await page.getByText(eventTitle).first().click();
    const detailDialog = page.getByRole("dialog", { name: "イベント詳細" });
    await expect(detailDialog).toBeVisible();

    page.once("dialog", (dialog) => dialog.dismiss());
    await detailDialog.getByRole("button", { name: "削除" }).click();
    // キャンセル時は detail panel が開いたまま (削除も close も走らない)。
    await expect(detailDialog).toBeVisible();

    // DB の行は残っている。
    const after = await getEventByTitle(admin, userId, eventTitle);
    expect(after.id).toBe(created.id);
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
    await addDialog.getByRole("tab", { name: "タスク" }).click();
    await addDialog.getByLabel("タイトル").fill(taskTitle);
    await addDialog.getByLabel("プロジェクト").selectOption({ label: projectName });
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

/**
 * DayTimeline は「今日」のローカル日付のイベントだけ描画する。e2e で
 * EventDetailPanel を開く動線（DayTimeline 上の event card クリック）を踏む
 * ためには、開始日付を実行日のローカルに合わせる必要がある。
 */
function todayDateStr(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}
