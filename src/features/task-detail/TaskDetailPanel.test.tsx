import { fireEvent, render as rtlRender } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { LatestDecomposeLog } from "../../entities/action-log/gateway";
import type { Event } from "../../entities/event/types";
import type { Project } from "../../entities/project/types";
import { ProjectsProvider } from "../../entities/project/ProjectsContext";
import { CorrectionFactorsProvider } from "../../entities/task/CorrectionFactorsContext";
import type { CorrectionFactor } from "../../entities/task/correction";
import type { Task } from "../../entities/task/types";
import { TaskDetailPanel, type TaskDetailPanelProps } from "./TaskDetailPanel";

// 依存イベント表示は現在時刻依存。テストは固定時刻 2026-04-11T09:00 で評価する。
const FIXED_NOW = new Date("2026-04-11T09:00:00");
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(FIXED_NOW);
});
afterEach(() => {
  vi.useRealTimers();
});

const projects: Project[] = [
  { id: "slo", name: "SLO推進", color: "#2D9F45", isPrimary: true, createdAt: "" },
];
const render = (ui: React.ReactElement, options: { factors?: readonly CorrectionFactor[] } = {}) =>
  rtlRender(
    <ProjectsProvider projects={projects}>
      <CorrectionFactorsProvider factors={options.factors ?? []}>{ui}</CorrectionFactorsProvider>
    </ProjectsProvider>,
  );

const baseTask: Task = {
  id: "t1",
  projectId: "slo",
  title: "Test Task",
  body: "## Test body\n\n本文",
  estimatedMinutes: 45,
  status: "idle",
  stackOrder: 0,
  dependsOnEventId: null,
  isInterruption: false,
  parentTaskId: null,
  decomposeStatus: "none",
  taskCategory: null,
  createdAt: "2026-04-11T00:00:00",
  completedAt: null,
};

const noop = () => {};

function renderPanel(
  overrides: Partial<TaskDetailPanelProps> = {},
  options: { factors?: readonly CorrectionFactor[] } = {},
) {
  const props: TaskDetailPanelProps = {
    task: baseTask,
    events: [],
    onClose: noop,
    onUpdate: noop,
    onToggleDone: noop,
    ...overrides,
  };
  return render(<TaskDetailPanel {...props} />, options);
}

describe("TaskDetailPanel", () => {
  test("タスクタイトルとプロジェクト名を表示する", () => {
    const { getByText } = renderPanel();
    expect(getByText("Test Task")).toBeTruthy();
    expect(getByText("SLO推進")).toBeTruthy();
  });

  test("未完了時は「完了にする」ボタン", () => {
    const { getByText } = renderPanel();
    expect(getByText("完了にする")).toBeTruthy();
  });

  test("完了済みは「未完了に戻す」ボタン", () => {
    const { getByText } = renderPanel({
      task: { ...baseTask, status: "done" },
    });
    expect(getByText("未完了に戻す")).toBeTruthy();
  });

  test("編集ボタン押下で保存・キャンセルボタンに切り替わる", () => {
    const { getByText, queryByText } = renderPanel();
    fireEvent.click(getByText("編集"));
    expect(getByText("保存")).toBeTruthy();
    expect(getByText("キャンセル")).toBeTruthy();
    expect(queryByText("編集")).toBeNull();
  });

  test("編集→textarea更新→保存で onUpdate(taskId, draft) が呼ばれる", () => {
    const onUpdate = vi.fn();
    const { getByText, getByPlaceholderText } = renderPanel({ onUpdate });
    fireEvent.click(getByText("編集"));
    const textarea = getByPlaceholderText(/Markdown/);
    fireEvent.change(textarea, { target: { value: "## Updated" } });
    fireEvent.click(getByText("保存"));
    expect(onUpdate).toHaveBeenCalledWith("t1", "## Updated");
  });

  test("キャンセルで編集モード解除（onUpdate は呼ばれない）", () => {
    const onUpdate = vi.fn();
    const { getByText } = renderPanel({ onUpdate });
    fireEvent.click(getByText("編集"));
    fireEvent.click(getByText("キャンセル"));
    expect(getByText("編集")).toBeTruthy();
    expect(onUpdate).not.toHaveBeenCalled();
  });

  test("完了ボタンで onToggleDone(taskId) と onClose が呼ばれる", () => {
    const onToggleDone = vi.fn();
    const onClose = vi.fn();
    const { getByText } = renderPanel({ onToggleDone, onClose });
    fireEvent.click(getByText("完了にする"));
    expect(onToggleDone).toHaveBeenCalledWith("t1");
    expect(onClose).toHaveBeenCalled();
  });

  test("dependsOnEventId がある場合、依存イベントの相対時刻 + タイトルバッジを表示", () => {
    const events: Event[] = [
      {
        id: "e1",
        title: "MTG",
        startTime: "2026-04-11T14:00:00",
        endTime: "2026-04-11T15:00:00",
        projectId: "slo",
        meetUrl: null,
        hasAttachments: false,
        description: "",
        source: "manual",
        externalId: null,
        createdAt: "2026-04-11T00:00:00",
      },
    ];
    const { getByText } = renderPanel({
      task: { ...baseTask, dependsOnEventId: "e1" },
      events,
    });
    expect(getByText(/今日 14:00 MTG/)).toBeTruthy();
  });

  test("onChangeDependency 未指定なら依存編集 UI を表示しない", () => {
    const { queryByText } = renderPanel();
    expect(queryByText("依存イベント")).toBeNull();
  });

  test("onChangeDependency 指定時は依存編集ボタンを表示する", () => {
    const { getByText } = renderPanel({ onChangeDependency: vi.fn() });
    expect(getByText("依存イベント")).toBeTruthy();
    expect(getByText(/なし.*を変更/)).toBeTruthy();
  });

  test("依存編集 → 未来イベントを選択すると onChangeDependency(taskId, eventId) を呼ぶ", () => {
    const onChangeDependency = vi.fn();
    const events: Event[] = [
      {
        id: "e1",
        title: "MTG",
        startTime: "2026-04-11T14:00:00",
        endTime: "2026-04-11T15:00:00",
        projectId: "slo",
        meetUrl: null,
        hasAttachments: false,
        description: "",
        source: "manual",
        externalId: null,
        createdAt: "2026-04-11T00:00:00",
      },
    ];
    const { getByText, getByRole } = renderPanel({
      events,
      onChangeDependency,
    });
    fireEvent.click(getByText(/なし.*を変更/));
    fireEvent.change(getByRole("combobox"), { target: { value: "e1" } });
    expect(onChangeDependency).toHaveBeenCalledWith("t1", "e1");
  });

  test("依存設定済 → 「なし」を選ぶと onChangeDependency(taskId, null) を呼ぶ", () => {
    const onChangeDependency = vi.fn();
    const events: Event[] = [
      {
        id: "e1",
        title: "MTG",
        startTime: "2026-04-11T14:00:00",
        endTime: "2026-04-11T15:00:00",
        projectId: "slo",
        meetUrl: null,
        hasAttachments: false,
        description: "",
        source: "manual",
        externalId: null,
        createdAt: "2026-04-11T00:00:00",
      },
    ];
    const { getByText, getByRole } = renderPanel({
      task: { ...baseTask, dependsOnEventId: "e1" },
      events,
      onChangeDependency,
    });
    fireEvent.click(getByText(/MTG.*を変更/));
    fireEvent.change(getByRole("combobox"), { target: { value: "" } });
    expect(onChangeDependency).toHaveBeenCalledWith("t1", null);
  });

  test("依存先未設定の編集候補に過去イベントは出ない", () => {
    const past: Event = {
      id: "past",
      title: "過去MTG",
      startTime: "2026-04-10T14:00:00",
      endTime: "2026-04-10T15:00:00",
      projectId: "slo",
      meetUrl: null,
      hasAttachments: false,
      description: "",
      source: "manual",
      externalId: null,
      createdAt: "2026-04-09T00:00:00",
    };
    const future: Event = {
      id: "future",
      title: "未来MTG",
      startTime: "2026-04-12T10:00:00",
      endTime: "2026-04-12T11:00:00",
      projectId: "slo",
      meetUrl: null,
      hasAttachments: false,
      description: "",
      source: "manual",
      externalId: null,
      createdAt: "2026-04-09T00:00:00",
    };
    const { getByText, queryByText } = renderPanel({
      events: [past, future],
      onChangeDependency: vi.fn(),
    });
    fireEvent.click(getByText(/なし.*を変更/));
    expect(queryByText(/過去MTG/)).toBeNull();
    expect(getByText(/未来MTG/)).toBeTruthy();
  });

  test("依存先が過去イベント (削除されず残ってる) の場合は候補に保持される", () => {
    const past: Event = {
      id: "past",
      title: "過去MTG",
      startTime: "2026-04-10T14:00:00",
      endTime: "2026-04-10T15:00:00",
      projectId: "slo",
      meetUrl: null,
      hasAttachments: false,
      description: "",
      source: "manual",
      externalId: null,
      createdAt: "2026-04-09T00:00:00",
    };
    const future: Event = {
      id: "future",
      title: "未来MTG",
      startTime: "2026-04-12T10:00:00",
      endTime: "2026-04-12T11:00:00",
      projectId: "slo",
      meetUrl: null,
      hasAttachments: false,
      description: "",
      source: "manual",
      externalId: null,
      createdAt: "2026-04-09T00:00:00",
    };
    const { getByText, getAllByRole } = renderPanel({
      task: { ...baseTask, dependsOnEventId: "past" },
      events: [past, future],
      onChangeDependency: vi.fn(),
    });
    fireEvent.click(getByText(/過去MTG.*を変更/));
    const options = getAllByRole("option");
    const labels = options.map((o) => o.textContent ?? "");
    expect(labels.some((l) => l.includes("過去MTG"))).toBe(true);
    expect(labels.some((l) => l.includes("未来MTG"))).toBe(true);
  });

  test("dependsOnEventId が events に無い (削除済) 場合は依存表示を出さない", () => {
    const { queryByText } = renderPanel({
      task: { ...baseTask, dependsOnEventId: "missing" },
      events: [],
    });
    // ヘッダの依存バッジは出ない (event 解決失敗 → null)
    expect(queryByText(/MTG/)).toBeNull();
  });

  test("body が空なら「詳細を追加...」プレースホルダー", () => {
    const { getByText } = renderPanel({ task: { ...baseTask, body: "" } });
    expect(getByText("詳細を追加...")).toBeTruthy();
  });

  test("estimatedMinutes を fmtDuration で表示", () => {
    const { getByText } = renderPanel({
      task: { ...baseTask, estimatedMinutes: 90 },
    });
    expect(getByText("1h30m")).toBeTruthy();
  });
});

// ADR 0015 / #90: タスク種類 override UI。AI 初期ラベルに対する人間の override で、
// 暗黙フィードバック (task_category_changed) の起点となる。logging 自体は呼び出し側
// (AppShell) の責務なので、ここではコールバックの引数だけを担保する。
//
// 体験は依存イベントと揃える: 通常はボタンに現在値 + 「を変更」、押すと <select> に
// 切り替わり、選ぶと閉じる (onBlur でも閉じる)。
describe("TaskDetailPanel - task_category override (P3-5)", () => {
  test("onChangeCategory 未指定なら category 編集 UI を出さない (旧呼び出し互換)", () => {
    const { queryByText } = renderPanel();
    expect(queryByText("タスク種類")).toBeNull();
    expect(queryByText(/未分類\s+を変更/)).toBeNull();
  });

  test("onChangeCategory 指定時、デフォルトは「<現在値> を変更」ボタン", () => {
    const { getByText, queryByRole } = renderPanel({ onChangeCategory: vi.fn() });
    expect(getByText(/未分類\s+を変更/)).toBeTruthy();
    expect(queryByRole("combobox")).toBeNull();
  });

  test("AI 初期ラベルがある場合はボタン文言にその表示ラベルが入る", () => {
    const { getByText } = renderPanel({
      task: { ...baseTask, taskCategory: "coding" },
      onChangeCategory: vi.fn(),
    });
    expect(getByText(/コーディング\s+を変更/)).toBeTruthy();
  });

  test("ボタン押下で <select> に切り替わり、現在値が反映されている", () => {
    const { getByText, getByRole } = renderPanel({
      task: { ...baseTask, taskCategory: "coding" },
      onChangeCategory: vi.fn(),
    });
    fireEvent.click(getByText(/コーディング\s+を変更/));
    const select = getByRole("combobox") as HTMLSelectElement;
    expect(select.value).toBe("coding");
  });

  test("値変更で onChangeCategory(taskId, value) を呼び、編集モードを抜ける", () => {
    const onChangeCategory = vi.fn();
    const { getByText, getByRole, queryByRole } = renderPanel({
      task: { ...baseTask, taskCategory: "coding" },
      onChangeCategory,
    });
    fireEvent.click(getByText(/コーディング\s+を変更/));
    fireEvent.change(getByRole("combobox"), { target: { value: "doc" } });
    expect(onChangeCategory).toHaveBeenCalledWith("t1", "doc");
    // 編集モード解除 (再びボタンに戻る)
    expect(queryByRole("combobox")).toBeNull();
  });

  test("「未分類」(空文字) を選ぶと onChangeCategory(taskId, null) を呼ぶ", () => {
    const onChangeCategory = vi.fn();
    const { getByText, getByRole } = renderPanel({
      task: { ...baseTask, taskCategory: "coding" },
      onChangeCategory,
    });
    fireEvent.click(getByText(/コーディング\s+を変更/));
    fireEvent.change(getByRole("combobox"), { target: { value: "" } });
    expect(onChangeCategory).toHaveBeenCalledWith("t1", null);
  });

  test("同じ値が選ばれた場合は onChangeCategory を呼ばないが編集モードは抜ける", () => {
    const onChangeCategory = vi.fn();
    const { getByText, getByRole, queryByRole } = renderPanel({
      task: { ...baseTask, taskCategory: "coding" },
      onChangeCategory,
    });
    fireEvent.click(getByText(/コーディング\s+を変更/));
    fireEvent.change(getByRole("combobox"), { target: { value: "coding" } });
    expect(onChangeCategory).not.toHaveBeenCalled();
    expect(queryByRole("combobox")).toBeNull();
  });

  test("blur で編集モードを抜ける (selecter 確定せずに閉じる)", () => {
    const onChangeCategory = vi.fn();
    const { getByText, getByRole, queryByRole } = renderPanel({
      task: { ...baseTask, taskCategory: "coding" },
      onChangeCategory,
    });
    fireEvent.click(getByText(/コーディング\s+を変更/));
    fireEvent.blur(getByRole("combobox"));
    expect(onChangeCategory).not.toHaveBeenCalled();
    expect(queryByRole("combobox")).toBeNull();
  });

  test("値域が UI に揃っている (coding / doc / research / admin / other + 未分類)", () => {
    const { getByText, getByRole } = renderPanel({ onChangeCategory: vi.fn() });
    fireEvent.click(getByText(/未分類\s+を変更/));
    const select = getByRole("combobox") as HTMLSelectElement;
    const values = Array.from(select.options).map((o) => o.value);
    expect(values).toEqual(["", "coding", "doc", "research", "admin", "other"]);
  });
});

// AI 分解情報エリア (P3-15 / ADR 0021 §3)。
// 親が `latestDecomposeLog` か `onTriggerDecompose` を渡したときだけセクションが描画される。
describe("TaskDetailPanel - AI 分解情報エリア (P3-15)", () => {
  test("latestDecomposeLog / onTriggerDecompose 未指定なら AI 分解情報エリアを描画しない (旧呼び出し互換)", () => {
    const { queryByText } = renderPanel();
    expect(queryByText("AI 分解")).toBeNull();
    expect(queryByText("AI 分解未試行")).toBeNull();
  });

  test("decomposeStatus=none + onTriggerDecompose 指定: 「AI 分解未試行」と「AI 分解を実行」ボタンを表示する", () => {
    const onTriggerDecompose = vi.fn();
    const { getByRole, getByText } = renderPanel({
      task: { ...baseTask, decomposeStatus: "none" },
      latestDecomposeLog: null,
      onTriggerDecompose,
    });
    expect(getByText("AI 分解未試行")).toBeTruthy();
    const btn = getByRole("button", { name: "AI 分解を実行" });
    expect(btn).toBeTruthy();
    expect((btn as HTMLButtonElement).disabled).toBe(false);
  });

  test("AI 分解を実行ボタン押下で onTriggerDecompose(taskId) を呼ぶ", () => {
    const onTriggerDecompose = vi.fn();
    const { getByRole } = renderPanel({
      task: { ...baseTask, decomposeStatus: "none" },
      latestDecomposeLog: null,
      onTriggerDecompose,
    });
    fireEvent.click(getByRole("button", { name: "AI 分解を実行" }));
    expect(onTriggerDecompose).toHaveBeenCalledWith("t1");
  });

  test("aiEnabled=false なら「AI 分解を実行」ボタンが disabled", () => {
    const onTriggerDecompose = vi.fn();
    const { getByRole } = renderPanel({
      task: { ...baseTask, decomposeStatus: "none" },
      latestDecomposeLog: null,
      aiEnabled: false,
      onTriggerDecompose,
    });
    const btn = getByRole("button", { name: "AI 分解を実行" }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  test("decomposeStatus=decomposing は「分解中…」を表示し、再実行ボタンは出さない", () => {
    const { getByText, queryByRole } = renderPanel({
      task: { ...baseTask, decomposeStatus: "decomposing" },
      latestDecomposeLog: null,
      onTriggerDecompose: vi.fn(),
    });
    expect(getByText("分解中…")).toBeTruthy();
    expect(queryByRole("button", { name: "AI 分解を実行" })).toBeNull();
    expect(queryByRole("button", { name: "再実行" })).toBeNull();
  });

  test("decomposeStatus=decomposed: 子タスク件数を表示し、再実行ボタンは出さない", () => {
    const log: LatestDecomposeLog = {
      action_type: "task_decomposed",
      metadata: { task_id: "t1", child_ids: ["c1", "c2", "c3"], raw_response: "raw" },
      created_at: "2026-04-11T00:30:00.000Z",
    };
    const { getByText, queryByRole } = renderPanel({
      task: { ...baseTask, decomposeStatus: "decomposed" },
      latestDecomposeLog: log,
      onTriggerDecompose: vi.fn(),
    });
    expect(getByText("分解完了（子タスク 3 件）")).toBeTruthy();
    expect(queryByRole("button", { name: "再実行" })).toBeNull();
    expect(queryByRole("button", { name: "AI 分解を実行" })).toBeNull();
  });

  test("decomposeStatus=skipped: 「AI が分解不要と判断」を表示し、再実行ボタンは出さない", () => {
    const log: LatestDecomposeLog = {
      action_type: "task_decompose_skipped",
      metadata: { task_id: "t1", raw_response: "small task, not splitting" },
      created_at: "2026-04-11T00:30:00.000Z",
    };
    const { getByText, queryByRole } = renderPanel({
      task: { ...baseTask, decomposeStatus: "skipped" },
      latestDecomposeLog: log,
      onTriggerDecompose: vi.fn(),
    });
    expect(getByText("AI が分解不要と判断")).toBeTruthy();
    expect(queryByRole("button", { name: "再実行" })).toBeNull();
  });

  test("decomposeStatus=failed (quota_exhausted): reason 文言と「再実行」ボタンを表示する", () => {
    const log: LatestDecomposeLog = {
      action_type: "task_decompose_failed",
      metadata: { task_id: "t1", reason: "quota_exhausted", error_message: "429" },
      created_at: "2026-04-11T00:30:00.000Z",
    };
    const onTriggerDecompose = vi.fn();
    const { getByText, getByRole } = renderPanel({
      task: { ...baseTask, decomposeStatus: "failed" },
      latestDecomposeLog: log,
      onTriggerDecompose,
    });
    expect(getByText(/分解失敗 — AI のクォータ上限に達しました/)).toBeTruthy();
    const btn = getByRole("button", { name: "再実行" }) as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
  });

  test("再実行ボタン押下で onTriggerDecompose(taskId) を呼ぶ", () => {
    const log: LatestDecomposeLog = {
      action_type: "task_decompose_failed",
      metadata: { task_id: "t1", reason: "upstream_unavailable" },
      created_at: "2026-04-11T00:30:00.000Z",
    };
    const onTriggerDecompose = vi.fn();
    const { getByRole } = renderPanel({
      task: { ...baseTask, decomposeStatus: "failed" },
      latestDecomposeLog: log,
      onTriggerDecompose,
    });
    fireEvent.click(getByRole("button", { name: "再実行" }));
    expect(onTriggerDecompose).toHaveBeenCalledWith("t1");
  });

  test("failed + aiEnabled=false: 「再実行」ボタンは disabled", () => {
    const log: LatestDecomposeLog = {
      action_type: "task_decompose_failed",
      metadata: { task_id: "t1", reason: "internal_error" },
      created_at: "2026-04-11T00:30:00.000Z",
    };
    const { getByRole } = renderPanel({
      task: { ...baseTask, decomposeStatus: "failed" },
      latestDecomposeLog: log,
      aiEnabled: false,
      onTriggerDecompose: vi.fn(),
    });
    expect((getByRole("button", { name: "再実行" }) as HTMLButtonElement).disabled).toBe(true);
  });

  test("decomposed: raw_response が <details>/<summary> で折りたたみ表示されている", () => {
    const log: LatestDecomposeLog = {
      action_type: "task_decomposed",
      metadata: {
        task_id: "t1",
        child_ids: ["c1"],
        raw_response: "[{title:'準備', estimated:30}]",
      },
      created_at: "2026-04-11T00:30:00.000Z",
    };
    const { getByText, container } = renderPanel({
      task: { ...baseTask, decomposeStatus: "decomposed" },
      latestDecomposeLog: log,
      onTriggerDecompose: vi.fn(),
    });
    const summary = getByText("AI 応答を表示");
    expect(summary.tagName.toLowerCase()).toBe("summary");
    const details = container.querySelector("details") as HTMLDetailsElement;
    expect(details).toBeTruthy();
    // 初期状態は閉じている
    expect(details.open).toBe(false);
    // raw response が DOM 内に存在 (details が閉じていても content は描画される)
    expect(getByText(/準備/)).toBeTruthy();
  });

  test("isDecomposeLogLoading=true: spinner (読み込み中) を表示し、raw response は出さない", () => {
    const { getByText, queryByText } = renderPanel({
      task: { ...baseTask, decomposeStatus: "decomposed" },
      latestDecomposeLog: null,
      isDecomposeLogLoading: true,
      onTriggerDecompose: vi.fn(),
    });
    expect(getByText("読み込み中…")).toBeTruthy();
    expect(queryByText("AI 応答を表示")).toBeNull();
    expect(queryByText("履歴なし")).toBeNull();
  });

  test("decomposed だが action_log が無い (legacy data) → 「履歴なし」", () => {
    const { getByText, queryByText } = renderPanel({
      task: { ...baseTask, decomposeStatus: "decomposed" },
      latestDecomposeLog: null,
      onTriggerDecompose: vi.fn(),
    });
    expect(getByText("履歴なし")).toBeTruthy();
    expect(queryByText("AI 応答を表示")).toBeNull();
  });

  test("failed で raw_response が無い (generate 自体が throw) ケースは AI 応答なし表示", () => {
    const log: LatestDecomposeLog = {
      action_type: "task_decompose_failed",
      metadata: { task_id: "t1", reason: "upstream_unavailable", error_message: "ETIMEDOUT" },
      created_at: "2026-04-11T00:30:00.000Z",
    };
    const { getByText } = renderPanel({
      task: { ...baseTask, decomposeStatus: "failed" },
      latestDecomposeLog: log,
      onTriggerDecompose: vi.fn(),
    });
    expect(getByText("AI 応答なし")).toBeTruthy();
  });

  test("AI 分解情報エリアは role=region (aria-label='AI 分解情報') として scope できる", () => {
    const { getByRole } = renderPanel({
      task: { ...baseTask, decomposeStatus: "none" },
      latestDecomposeLog: null,
      onTriggerDecompose: vi.fn(),
    });
    // <section aria-label="..."> は ARIA で region として扱われる
    const section = getByRole("region", { name: "AI 分解情報" });
    expect(section).toBeTruthy();
  });
});

describe("TaskDetailPanel: 見積もり補正 (P3-9 / #93、ADR 0026)", () => {
  test("補正なし (category null) は元値だけを faint で出し、自然文は出さない", () => {
    const { getByText, queryByText } = renderPanel(
      { task: { ...baseTask, estimatedMinutes: 30, taskCategory: null } },
      {
        factors: [{ taskCategory: "doc", factor: 2.2, sampleCount: 7 }],
      },
    );
    expect(getByText("30m")).toBeTruthy();
    expect(queryByText(/同じ種類のタスク/)).toBeNull();
    expect(queryByText(/あなたの見積もり/)).toBeNull();
  });

  test("補正適用時はヘッダに補正後を出し、title 下の自然文に元値と倍率を添える", () => {
    const { getByText, queryByText } = renderPanel(
      {
        task: { ...baseTask, estimatedMinutes: 30, taskCategory: "doc" },
      },
      {
        factors: [{ taskCategory: "doc", factor: 2.2, sampleCount: 7 }],
      },
    );
    // ヘッダに補正後の値 (30 * 2.2 = 66 → 1h06m)
    expect(getByText("1h06m")).toBeTruthy();
    // 自然文ライン (補正の存在は明言しない、ADR 0026)
    expect(getByText(/あなたの見積もり 30m/)).toBeTruthy();
    expect(getByText(/同じ種類のタスクは平均 2\.2 倍かかっています/)).toBeTruthy();
    // ADR 0026: 「補正係数」「補正済み」「元」「確保」等のラベルは出さない
    expect(queryByText(/補正/)).toBeNull();
    expect(queryByText(/^元 /)).toBeNull();
  });

  test("最小サンプル数閾値未満は補正なし扱い (元値のみ + 自然文なし)", () => {
    const { getByText, queryByText } = renderPanel(
      {
        task: { ...baseTask, estimatedMinutes: 30, taskCategory: "doc" },
      },
      {
        factors: [{ taskCategory: "doc", factor: 2.2, sampleCount: 2 }],
      },
    );
    expect(getByText("30m")).toBeTruthy();
    expect(queryByText(/同じ種類のタスク/)).toBeNull();
  });

  test("estimatedMinutes が null なら見積もり関連の表示は一切出ない", () => {
    const { queryByText } = renderPanel(
      { task: { ...baseTask, estimatedMinutes: null, taskCategory: "doc" } },
      { factors: [{ taskCategory: "doc", factor: 2.2, sampleCount: 7 }] },
    );
    expect(queryByText(/30m/)).toBeNull();
    expect(queryByText(/あなたの見積もり/)).toBeNull();
  });
});

// 子タスクの再分解 (Issue #121 / ADR 0027): 親 (parentTaskId=null) と子 (parentTaskId 有り) で
// 同じ AI 分解情報スロットを共用しつつ、ボタン文言と handler が切り替わる。
const childTask: Task = {
  ...baseTask,
  id: "child-B",
  parentTaskId: "parent-1",
  title: "本文を書く",
};

describe("TaskDetailPanel - 子タスクの再分解 (Issue #121 / ADR 0027)", () => {
  test("子タスク + onTriggerResplit 指定: 「もっと細かく」ボタンを表示する", () => {
    const onTriggerResplit = vi.fn();
    const { getByRole, queryByRole } = renderPanel({
      task: { ...childTask, decomposeStatus: "none" },
      latestDecomposeLog: null,
      onTriggerResplit,
    });
    const btn = getByRole("button", { name: "もっと細かく" });
    expect(btn).toBeTruthy();
    expect((btn as HTMLButtonElement).disabled).toBe(false);
    // 親側の文言は出ない
    expect(queryByRole("button", { name: "AI 分解を実行" })).toBeNull();
  });

  test("「もっと細かく」押下で onTriggerResplit(taskId) を呼ぶ", () => {
    const onTriggerResplit = vi.fn();
    const { getByRole } = renderPanel({
      task: { ...childTask, decomposeStatus: "none" },
      latestDecomposeLog: null,
      onTriggerResplit,
    });
    fireEvent.click(getByRole("button", { name: "もっと細かく" }));
    expect(onTriggerResplit).toHaveBeenCalledWith("child-B");
  });

  test("子タスク + decomposeStatus=failed: 「もっと細かく」が引き続き出てリトライを兼ねる", () => {
    const log: LatestDecomposeLog = {
      action_type: "task_decompose_failed",
      metadata: { task_id: "child-B", reason: "upstream_unavailable" },
      created_at: "2026-04-30T09:30:00.000Z",
    };
    const onTriggerResplit = vi.fn();
    const { getByRole, queryByRole } = renderPanel({
      task: { ...childTask, decomposeStatus: "failed" },
      latestDecomposeLog: log,
      onTriggerResplit,
    });
    expect(getByRole("button", { name: "もっと細かく" })).toBeTruthy();
    // 親側の「再実行」文言は出ない (子は 1 つのボタンで初回 / リトライを兼ねる)
    expect(queryByRole("button", { name: "再実行" })).toBeNull();
  });

  test("子タスク + onTriggerResplit 未指定: ボタンを出さない (旧呼び出し互換)", () => {
    const { queryByRole } = renderPanel({
      task: { ...childTask, decomposeStatus: "none" },
      latestDecomposeLog: null,
    });
    expect(queryByRole("button", { name: "もっと細かく" })).toBeNull();
    expect(queryByRole("button", { name: "AI 分解を実行" })).toBeNull();
  });

  test("子タスクで onTriggerDecompose のみ渡されてもボタンは出ない (親の handler は子に流用しない)", () => {
    const onTriggerDecompose = vi.fn();
    const { queryByRole } = renderPanel({
      task: { ...childTask, decomposeStatus: "none" },
      latestDecomposeLog: null,
      onTriggerDecompose,
    });
    expect(queryByRole("button", { name: "もっと細かく" })).toBeNull();
    expect(queryByRole("button", { name: "AI 分解を実行" })).toBeNull();
  });

  test("子タスク + aiEnabled=false: 「もっと細かく」が disabled", () => {
    const onTriggerResplit = vi.fn();
    const { getByRole } = renderPanel({
      task: { ...childTask, decomposeStatus: "none" },
      latestDecomposeLog: null,
      aiEnabled: false,
      onTriggerResplit,
    });
    expect((getByRole("button", { name: "もっと細かく" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  test("子タスク + decomposeStatus=decomposing: ボタンを出さず「分解中…」のみ", () => {
    const { getByText, queryByRole } = renderPanel({
      task: { ...childTask, decomposeStatus: "decomposing" },
      latestDecomposeLog: null,
      onTriggerResplit: vi.fn(),
    });
    expect(getByText("分解中…")).toBeTruthy();
    expect(queryByRole("button", { name: "もっと細かく" })).toBeNull();
  });

  test("親タスク (parentTaskId=null) + onTriggerResplit のみ: 「もっと細かく」は出ない (親は decompose 経路)", () => {
    const onTriggerResplit = vi.fn();
    const { queryByRole } = renderPanel({
      task: { ...baseTask, decomposeStatus: "none" }, // baseTask は parentTaskId: null
      latestDecomposeLog: null,
      onTriggerResplit,
    });
    expect(queryByRole("button", { name: "もっと細かく" })).toBeNull();
    expect(queryByRole("button", { name: "AI 分解を実行" })).toBeNull();
  });
});
