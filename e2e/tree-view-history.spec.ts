import { expect, test } from "./fixtures";

/**
 * Issue #78: Tree View が mock history を期待通り描画することを e2e で保証する。
 *
 * Phase 1 では TreeView は `src/mocks/history.ts` の固定データを描画する PoC。
 * 将来 (Phase 3) AI 提案の根拠として TreeView を活用する前提があるため、
 * 描画が壊れたことを golden-path 以外でも検知できるようにしておく。
 *
 * AppShell は user の projects が空のとき history mock の projectId
 * (`career` / `slo` / `loadtest` / `tasuki`) を `projectOrderForTree` の
 * fallback に使う。signedInPage fixture は purge 済みなので必ずこの分岐を踏む。
 */
test("Tree View renders mock history grouped by date with project legend", async ({
  signedInPage: page,
}) => {
  // Tree View へ遷移 (golden-path と同じ semantic locator)。
  await page.getByRole("link", { name: "Tree" }).click();
  await page.waitForURL((url) => url.pathname === "/tree");

  // TreeView 全体は role=region (aria-label="作業履歴") で scope する。
  const treeView = page.getByRole("region", { name: "作業履歴" });
  await expect(treeView).toBeVisible();

  // --- プロジェクト凡例 -----------------------------------------------------
  // history mock の 4 slug が PROJECT_SEEDS 由来の表示名で並ぶ
  // (mergeTreeProjects: career=転職活動 / slo=SLO推進 / loadtest=負荷試験 / tasuki=Tasuki)。
  const legend = treeView.getByRole("list", { name: "プロジェクト凡例" });
  const legendItems = legend.getByRole("listitem");
  await expect(legendItems).toHaveCount(4);
  await expect(legendItems.filter({ hasText: "転職活動" })).toBeVisible();
  await expect(legendItems.filter({ hasText: "SLO推進" })).toBeVisible();
  await expect(legendItems.filter({ hasText: "負荷試験" })).toBeVisible();
  await expect(legendItems.filter({ hasText: "Tasuki" })).toBeVisible();

  // --- 日付見出し -----------------------------------------------------------
  // mock は 2026-04-05〜04-10 の 6 日付。groupByDateDesc により降順。
  const dateHeadings = treeView.getByRole("heading", { level: 3 });
  await expect(dateHeadings).toHaveCount(6);
  await expect(dateHeadings.first()).toHaveText("4/10 (金)");
  await expect(dateHeadings.last()).toHaveText("4/5 (日)");

  // --- 各日付ごとの履歴 -----------------------------------------------------
  // DateGroup の <ul> は aria-label="<date> の履歴"。日付スコープで listitem を取れる。
  const apr5 = treeView.getByRole("list", { name: "4/5 (日) の履歴" });
  await expect(apr5.getByRole("listitem")).toHaveCount(2);
  await expect(apr5.getByRole("listitem").filter({ hasText: "転職ドラフト応募完了" })).toBeVisible();
  await expect(apr5.getByRole("listitem").filter({ hasText: "SLI候補の洗い出し" })).toBeVisible();

  const apr10 = treeView.getByRole("list", { name: "4/10 (金) の履歴" });
  await expect(apr10.getByRole("listitem")).toHaveCount(2);
  await expect(
    apr10.getByRole("listitem").filter({ hasText: "エラーバジェットポリシー草案" }),
  ).toBeVisible();
  await expect(apr10.getByRole("listitem").filter({ hasText: "ECS Fargate構成設計" })).toBeVisible();

  // --- 全 11 件の網羅的な確認 -----------------------------------------------
  // legend (4) + 履歴エントリ (11) = 15 listitem が treeView 配下に存在するはず。
  // 「合計件数」で守ることで、items の追加漏れ / 重複描画を検知できる。
  await expect(treeView.getByRole("listitem")).toHaveCount(4 + 11);

  // 残り 7 件 (4/5 と 4/10 で確認した 4 件以外) が描画されていることもサンプル確認。
  for (const title of [
    "Locust環境セットアップ",
    "php-parser PoC完了",
    "Finatext オファー検討",
    "New Relicアラート設定",
    "WireMock導入調査",
    "ULS企業研究メモ作成",
    "Terminal埋め込みPoC",
  ]) {
    await expect(treeView.getByRole("listitem").filter({ hasText: title })).toBeVisible();
  }
});
