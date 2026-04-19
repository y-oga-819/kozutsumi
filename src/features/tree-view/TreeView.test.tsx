import { render } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import type { HistoryEntry } from "../../entities/task/types";
import type { ProjectKey } from "../../entities/project/types";
import { TreeView } from "./TreeView";

const projectOrder: ProjectKey[] = ["career", "loadtest", "slo", "tasuki"];

const history: HistoryEntry[] = [
  { id: "h1", projectId: "career", title: "転職ドラフト応募完了", date: "2026-04-05" },
  { id: "h2", projectId: "slo", title: "SLI候補の洗い出し", date: "2026-04-05" },
  { id: "h3", projectId: "tasuki", title: "php-parser PoC完了", date: "2026-04-06" },
];

describe("TreeView", () => {
  test("空 historyData でも crash しない", () => {
    const { container } = render(
      <TreeView historyData={[]} projectOrder={projectOrder} />,
    );
    expect(container.firstChild).toBeTruthy();
  });

  test("プロジェクトレジェンド（名前）を表示する", () => {
    const { getByText } = render(
      <TreeView historyData={history} projectOrder={projectOrder} />,
    );
    expect(getByText("転職活動")).toBeTruthy();
    expect(getByText("SLO推進")).toBeTruthy();
    expect(getByText("Tasuki")).toBeTruthy();
  });

  test("各タスクタイトルを表示する", () => {
    const { getByText } = render(
      <TreeView historyData={history} projectOrder={projectOrder} />,
    );
    expect(getByText("転職ドラフト応募完了")).toBeTruthy();
    expect(getByText("SLI候補の洗い出し")).toBeTruthy();
    expect(getByText("php-parser PoC完了")).toBeTruthy();
  });

  test("日付見出し（formatDate）を表示する", () => {
    const { getByText } = render(
      <TreeView historyData={history} projectOrder={projectOrder} />,
    );
    // 2026-04-05 は日曜、2026-04-06 は月曜
    expect(getByText("4/5 (日)")).toBeTruthy();
    expect(getByText("4/6 (月)")).toBeTruthy();
  });

  test("日付は降順で並ぶ", () => {
    const { container } = render(
      <TreeView historyData={history} projectOrder={projectOrder} />,
    );
    const text = container.textContent;
    const idx6 = text.indexOf("4/6");
    const idx5 = text.indexOf("4/5");
    expect(idx6).toBeGreaterThan(-1);
    expect(idx5).toBeGreaterThan(idx6);
  });
});
