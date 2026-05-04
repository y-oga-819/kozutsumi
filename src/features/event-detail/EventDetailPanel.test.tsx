import { fireEvent, render as rtlRender, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { UpdateEventInput } from "../../entities/event/gateway";
import type { Event, EventVisibilityOverride } from "../../entities/event/types";
import type { Project } from "../../entities/project/types";
import { ProjectsProvider } from "../../entities/project/ProjectsContext";
import { EventDetailPanel } from "./EventDetailPanel";

const projects: Project[] = [
  { id: "slo", name: "SLO推進", color: "#2D9F45", isPrimary: true, createdAt: "" },
  { id: "career", name: "転職活動", color: "#E85D04", isPrimary: false, createdAt: "" },
];
const render = (ui: React.ReactElement) =>
  rtlRender(<ProjectsProvider projects={projects}>{ui}</ProjectsProvider>);

const baseEvent: Event = {
  id: "e1",
  title: "SLO レビュー",
  startTime: "2026-04-11T10:00:00",
  endTime: "2026-04-11T11:00:00",
  projectId: "slo",
  meetUrl: null,
  hasAttachments: false,
  description: "## アジェンダ\n\n本文",
  source: "manual",
  externalId: null,
  externalCalendarId: "manual",
  visibilityOverride: "none",
  createdAt: "2026-04-11T00:00:00",
};

const googleEvent: Event = {
  ...baseEvent,
  id: "g1",
  source: "google_calendar",
  externalId: "ext-1",
  externalCalendarId: "primary",
};

const noop = () => {};

function renderPanel(
  overrides: Partial<{
    event: Event;
    onClose: () => void;
    onChangeProject: (id: string, projectId: string | null) => void;
    onUpdate: (id: string, patch: UpdateEventInput) => Promise<void> | void;
    onDelete: (id: string) => Promise<void> | void;
    onSetVisibilityOverride: (id: string, value: EventVisibilityOverride) => Promise<void> | void;
    subscriptionAutoPromote: boolean;
  }> = {},
) {
  const props = { event: baseEvent, onClose: noop, ...overrides };
  return render(<EventDetailPanel {...props} />);
}

describe("EventDetailPanel", () => {
  test("タイトル・プロジェクト名・時刻レンジを表示", () => {
    const { getByText } = renderPanel();
    expect(getByText("SLO レビュー")).toBeTruthy();
    expect(getByText("SLO推進")).toBeTruthy();
    expect(getByText(/10:00–11:00/)).toBeTruthy();
  });

  test("projectId なしの event ではプロジェクトバッジを非表示", () => {
    const { queryByText } = renderPanel({
      event: { ...baseEvent, projectId: null },
    });
    expect(queryByText("SLO推進")).toBeNull();
  });

  test("Meet URL (google meet) の参加ボタンを表示", () => {
    const { getByText } = renderPanel({
      event: { ...baseEvent, meetUrl: "https://meet.google.com/abc-defg-hij" },
    });
    expect(getByText("Google Meetに参加")).toBeTruthy();
  });

  test("Meet URL (zoom) の参加ボタンを表示", () => {
    const { getByText } = renderPanel({
      event: { ...baseEvent, meetUrl: "https://zoom.us/j/123" },
    });
    expect(getByText("Zoomに参加")).toBeTruthy();
  });

  test("Meet URL なしなら参加ボタンは表示されない", () => {
    const { queryByText } = renderPanel();
    expect(queryByText(/に参加$/)).toBeNull();
  });

  test("hasAttachments=true なら「添付資料あり」を表示", () => {
    const { getByText } = renderPanel({
      event: { ...baseEvent, hasAttachments: true },
    });
    expect(getByText("添付資料あり")).toBeTruthy();
  });

  test("hasAttachments=false なら添付バッジを表示しない", () => {
    const { queryByText } = renderPanel();
    expect(queryByText("添付資料あり")).toBeNull();
  });

  test("description が空なら「詳細なし」", () => {
    const { getByText } = renderPanel({
      event: { ...baseEvent, description: "" },
    });
    expect(getByText("詳細なし")).toBeTruthy();
  });

  test("description は Markdown としてレンダーされる", () => {
    const { getByText } = renderPanel();
    expect(getByText("アジェンダ")).toBeTruthy();
  });

  test("backdrop クリックで onClose が呼ばれる", () => {
    const onClose = vi.fn();
    const { container } = renderPanel({ onClose });
    // Backdrop は role=dialog コンテナの最初の子 div
    const backdrop = container.firstElementChild!.firstElementChild!;
    fireEvent.click(backdrop);
    expect(onClose).toHaveBeenCalled();
  });

  test("role='dialog' + aria-modal で modal landmark を立てる (a11y)", () => {
    const { getByRole } = renderPanel();
    const dialog = getByRole("dialog", { name: "イベント詳細" });
    expect(dialog).toBeTruthy();
    expect(dialog.getAttribute("aria-modal")).toBe("true");
  });

  // ADR 0010 / P2-4: source 別の編集制約
  describe("source による表示・編集制約", () => {
    test("manual: Google バッジ・補足テキスト・project 編集 UI を出さない", () => {
      const { queryByTestId, queryByText } = renderPanel({
        onChangeProject: vi.fn(),
      });
      expect(queryByTestId("google-calendar-badge")).toBeNull();
      expect(queryByText(/Google Calendar で編集した内容は次回同期で反映されます/)).toBeNull();
      // canEditProject = isGoogleCalendar && !!onChangeProject なので manual では出ない
      expect(queryByText(/を変更$/)).toBeNull();
    });

    test("google_calendar: Google バッジと同期補足テキストを出す", () => {
      const { getByTestId, getByText } = renderPanel({ event: googleEvent });
      expect(getByTestId("google-calendar-badge")).toBeTruthy();
      expect(getByText(/Google Calendar で編集した内容は次回同期で反映されます/)).toBeTruthy();
    });

    test("google_calendar: onChangeProject 未指定なら project 編集 UI を出さない", () => {
      const { queryByText } = renderPanel({ event: googleEvent });
      expect(queryByText(/を変更$/)).toBeNull();
    });

    test("google_calendar: project 変更ボタンから select に切り替わる", () => {
      const onChangeProject = vi.fn();
      const { getByText, getByRole } = renderPanel({
        event: googleEvent,
        onChangeProject,
      });
      fireEvent.click(getByText(/を変更$/));
      const select = getByRole("combobox") as HTMLSelectElement;
      expect(select.value).toBe("slo");
    });

    test("google_calendar: select で project を変えると onChangeProject が呼ばれる", () => {
      const onChangeProject = vi.fn();
      const { getByText, getByRole } = renderPanel({
        event: googleEvent,
        onChangeProject,
      });
      fireEvent.click(getByText(/を変更$/));
      fireEvent.change(getByRole("combobox"), { target: { value: "career" } });
      expect(onChangeProject).toHaveBeenCalledWith("g1", "career");
    });

    test("google_calendar: project を「なし」にすると null で呼ばれる", () => {
      const onChangeProject = vi.fn();
      const { getByText, getByRole } = renderPanel({
        event: googleEvent,
        onChangeProject,
      });
      fireEvent.click(getByText(/を変更$/));
      fireEvent.change(getByRole("combobox"), { target: { value: "" } });
      expect(onChangeProject).toHaveBeenCalledWith("g1", null);
    });

    test("manual: onUpdate / onDelete 未指定なら編集 / 削除ボタンを出さない", () => {
      const { queryByRole } = renderPanel();
      expect(queryByRole("button", { name: "編集" })).toBeNull();
      expect(queryByRole("button", { name: "削除" })).toBeNull();
    });

    test("google_calendar: onUpdate / onDelete を渡しても編集 / 削除ボタンを出さない (ADR 0010)", () => {
      const { queryByRole } = renderPanel({
        event: googleEvent,
        onChangeProject: vi.fn(),
        onUpdate: vi.fn(),
        onDelete: vi.fn(),
      });
      expect(queryByRole("button", { name: "編集" })).toBeNull();
      expect(queryByRole("button", { name: "削除" })).toBeNull();
    });
  });

  describe("manual イベントの編集 (ADR 0010 / Issue #76)", () => {
    test("onUpdate を渡すと「編集」ボタンが出る", () => {
      const { getByRole } = renderPanel({ onUpdate: vi.fn() });
      expect(getByRole("button", { name: "編集" })).toBeTruthy();
    });

    test("「編集」をクリックするとフォームが現れ、各フィールドが event 値で初期化される", () => {
      const { getByRole, getByLabelText } = renderPanel({
        event: {
          ...baseEvent,
          meetUrl: "https://meet.google.com/old",
          description: "old body",
        },
        onUpdate: vi.fn(),
      });
      fireEvent.click(getByRole("button", { name: "編集" }));
      expect((getByLabelText("タイトル") as HTMLInputElement).value).toBe("SLO レビュー");
      // datetime-local はローカル tz の YYYY-MM-DDTHH:MM
      expect((getByLabelText("開始") as HTMLInputElement).value).toBe("2026-04-11T10:00");
      expect((getByLabelText("終了") as HTMLInputElement).value).toBe("2026-04-11T11:00");
      expect((getByLabelText("プロジェクト (任意)") as HTMLSelectElement).value).toBe("slo");
      expect((getByLabelText("会議URL (任意)") as HTMLInputElement).value).toBe(
        "https://meet.google.com/old",
      );
      expect((getByLabelText("本文 (任意, Markdown)") as HTMLTextAreaElement).value).toBe(
        "old body",
      );
    });

    test("フォームを編集して保存すると onUpdate が patch 全量で呼ばれる", async () => {
      const onUpdate = vi.fn().mockResolvedValue(undefined);
      const { getByRole, getByLabelText } = renderPanel({ onUpdate });
      fireEvent.click(getByRole("button", { name: "編集" }));
      fireEvent.change(getByLabelText("タイトル"), { target: { value: "新タイトル" } });
      fireEvent.change(getByLabelText("開始"), { target: { value: "2026-04-12T09:30" } });
      fireEvent.change(getByLabelText("終了"), { target: { value: "2026-04-12T10:30" } });
      fireEvent.change(getByLabelText("プロジェクト (任意)"), { target: { value: "career" } });
      fireEvent.change(getByLabelText("会議URL (任意)"), {
        target: { value: "https://zoom.us/j/999" },
      });
      fireEvent.change(getByLabelText("本文 (任意, Markdown)"), {
        target: { value: "新しい本文" },
      });
      fireEvent.click(getByRole("button", { name: "保存" }));
      await waitFor(() => {
        expect(onUpdate).toHaveBeenCalledWith("e1", {
          title: "新タイトル",
          startTime: "2026-04-12T09:30:00",
          endTime: "2026-04-12T10:30:00",
          projectId: "career",
          meetUrl: "https://zoom.us/j/999",
          description: "新しい本文",
        });
      });
    });

    test("プロジェクト「なし」 / Meet URL 空白 は null で送る", async () => {
      const onUpdate = vi.fn().mockResolvedValue(undefined);
      const { getByRole, getByLabelText } = renderPanel({ onUpdate });
      fireEvent.click(getByRole("button", { name: "編集" }));
      fireEvent.change(getByLabelText("プロジェクト (任意)"), { target: { value: "" } });
      fireEvent.change(getByLabelText("会議URL (任意)"), { target: { value: "  " } });
      fireEvent.click(getByRole("button", { name: "保存" }));
      await waitFor(() => {
        expect(onUpdate).toHaveBeenCalledWith(
          "e1",
          expect.objectContaining({ projectId: null, meetUrl: null }),
        );
      });
    });

    test("タイトル空で保存するとエラー表示で onUpdate を呼ばない", () => {
      const onUpdate = vi.fn();
      const { getByRole, getByLabelText, getByRole: _gr, getByText } = renderPanel({ onUpdate });
      fireEvent.click(getByRole("button", { name: "編集" }));
      fireEvent.change(getByLabelText("タイトル"), { target: { value: "  " } });
      fireEvent.click(getByRole("button", { name: "保存" }));
      expect(onUpdate).not.toHaveBeenCalled();
      expect(getByText("タイトルは必須です")).toBeTruthy();
      void _gr;
    });

    test("終了 <= 開始 で保存するとエラー表示で onUpdate を呼ばない", () => {
      const onUpdate = vi.fn();
      const { getByRole, getByLabelText, getByText } = renderPanel({ onUpdate });
      fireEvent.click(getByRole("button", { name: "編集" }));
      fireEvent.change(getByLabelText("開始"), { target: { value: "2026-04-12T10:00" } });
      fireEvent.change(getByLabelText("終了"), { target: { value: "2026-04-12T09:00" } });
      fireEvent.click(getByRole("button", { name: "保存" }));
      expect(onUpdate).not.toHaveBeenCalled();
      expect(getByText("終了時刻は開始時刻より後にしてください")).toBeTruthy();
    });

    test("キャンセルで編集モードを抜けて元の表示に戻る", () => {
      const onUpdate = vi.fn();
      const { getByRole, queryByLabelText } = renderPanel({ onUpdate });
      fireEvent.click(getByRole("button", { name: "編集" }));
      expect(queryByLabelText("タイトル")).toBeTruthy();
      fireEvent.click(getByRole("button", { name: "キャンセル" }));
      expect(queryByLabelText("タイトル")).toBeNull();
      expect(onUpdate).not.toHaveBeenCalled();
    });

    test("onUpdate が reject すると error が表示され編集モードに留まる", async () => {
      const onUpdate = vi.fn().mockRejectedValue(new Error("DB error"));
      const { getByRole, getByLabelText, findByText } = renderPanel({ onUpdate });
      fireEvent.click(getByRole("button", { name: "編集" }));
      fireEvent.click(getByRole("button", { name: "保存" }));
      expect(await findByText("DB error")).toBeTruthy();
      // 編集モードのまま (タイトル input が残る)
      expect(getByLabelText("タイトル")).toBeTruthy();
    });
  });

  // Issue #145 / ADR 0031 Layer 3 / ADR 0032: 予定化 / 予定化解除の toggle UI
  describe("予定化 toggle (Issue #145)", () => {
    test("onSetVisibilityOverride 未指定なら toggle ボタンを出さない", () => {
      const { queryByRole } = renderPanel();
      expect(queryByRole("button", { name: "予定化解除" })).toBeNull();
      expect(queryByRole("button", { name: "予定化する" })).toBeNull();
    });

    test("override='none' + auto_promote=true → 予定化中 / 予定化解除 ボタン", () => {
      const { getByText, getByRole } = renderPanel({
        onSetVisibilityOverride: vi.fn(),
        subscriptionAutoPromote: true,
      });
      expect(getByText("予定化中（自動）")).toBeTruthy();
      expect(getByRole("button", { name: "予定化解除" })).toBeTruthy();
    });

    test("override='none' + auto_promote=false → 予定化解除中 / 予定化する ボタン", () => {
      const { getByText, getByRole } = renderPanel({
        onSetVisibilityOverride: vi.fn(),
        subscriptionAutoPromote: false,
      });
      expect(getByText("予定化解除中（自動）")).toBeTruthy();
      expect(getByRole("button", { name: "予定化する" })).toBeTruthy();
    });

    test("override='shown' は default に関係なく予定化中表示", () => {
      const { getByText, queryByText } = renderPanel({
        event: { ...baseEvent, visibilityOverride: "shown" },
        onSetVisibilityOverride: vi.fn(),
        subscriptionAutoPromote: false,
      });
      expect(getByText("予定化中")).toBeTruthy();
      // (自動) ラベルは override='none' のときだけ
      expect(queryByText("予定化中（自動）")).toBeNull();
    });

    test("override='hidden' は default に関係なく予定化解除中表示", () => {
      const { getByText } = renderPanel({
        event: { ...baseEvent, visibilityOverride: "hidden" },
        onSetVisibilityOverride: vi.fn(),
        subscriptionAutoPromote: true,
      });
      expect(getByText("予定化解除中")).toBeTruthy();
    });

    test("予定化解除ボタン → onSetVisibilityOverride('hidden')", async () => {
      const onSetVisibilityOverride = vi.fn().mockResolvedValue(undefined);
      const { getByRole } = renderPanel({
        onSetVisibilityOverride,
        subscriptionAutoPromote: true,
      });
      fireEvent.click(getByRole("button", { name: "予定化解除" }));
      await waitFor(() => {
        expect(onSetVisibilityOverride).toHaveBeenCalledWith("e1", "hidden");
      });
    });

    test("予定化するボタン → onSetVisibilityOverride('shown')", async () => {
      const onSetVisibilityOverride = vi.fn().mockResolvedValue(undefined);
      const { getByRole } = renderPanel({
        event: { ...baseEvent, visibilityOverride: "hidden" },
        onSetVisibilityOverride,
        subscriptionAutoPromote: true,
      });
      fireEvent.click(getByRole("button", { name: "予定化する" }));
      await waitFor(() => {
        expect(onSetVisibilityOverride).toHaveBeenCalledWith("e1", "shown");
      });
    });

    test("onSetVisibilityOverride reject 時はエラー文言を表示", async () => {
      const onSetVisibilityOverride = vi.fn().mockRejectedValue(new Error("rpc failed"));
      const { getByRole, findByText } = renderPanel({
        onSetVisibilityOverride,
        subscriptionAutoPromote: true,
      });
      fireEvent.click(getByRole("button", { name: "予定化解除" }));
      expect(await findByText("rpc failed")).toBeTruthy();
    });
  });

  describe("manual イベントの削除 (ADR 0010 / Issue #76)", () => {
    // happy-dom は window.confirm を未実装。テストで上書きするため自前で stub する。
    let originalConfirm: typeof window.confirm | undefined;
    let confirmReturn = true;

    beforeEach(() => {
      originalConfirm = window.confirm;
      confirmReturn = true;
      window.confirm = vi.fn(() => confirmReturn) as typeof window.confirm;
    });

    afterEach(() => {
      if (originalConfirm) window.confirm = originalConfirm;
    });

    test("onDelete を渡すと「削除」ボタンが出る", () => {
      const { getByRole } = renderPanel({ onDelete: vi.fn() });
      expect(getByRole("button", { name: "削除" })).toBeTruthy();
    });

    test("削除ボタン → confirm OK で onDelete + onClose が呼ばれる", async () => {
      confirmReturn = true;
      const onDelete = vi.fn().mockResolvedValue(undefined);
      const onClose = vi.fn();
      const { getByRole } = renderPanel({ onDelete, onClose });
      fireEvent.click(getByRole("button", { name: "削除" }));
      await waitFor(() => {
        expect(onDelete).toHaveBeenCalledWith("e1");
        expect(onClose).toHaveBeenCalled();
      });
    });

    test("削除ボタン → confirm キャンセルなら onDelete を呼ばない", () => {
      confirmReturn = false;
      const onDelete = vi.fn();
      const onClose = vi.fn();
      const { getByRole } = renderPanel({ onDelete, onClose });
      fireEvent.click(getByRole("button", { name: "削除" }));
      expect(onDelete).not.toHaveBeenCalled();
      expect(onClose).not.toHaveBeenCalled();
    });

    test("onDelete が reject すると error が表示され onClose を呼ばない", async () => {
      confirmReturn = true;
      const onDelete = vi.fn().mockRejectedValue(new Error("delete failed"));
      const onClose = vi.fn();
      const { getByRole, findByText } = renderPanel({ onDelete, onClose });
      fireEvent.click(getByRole("button", { name: "削除" }));
      expect(await findByText("delete failed")).toBeTruthy();
      expect(onClose).not.toHaveBeenCalled();
    });
  });
});
