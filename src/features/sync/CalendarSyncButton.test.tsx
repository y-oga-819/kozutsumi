import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import { CalendarSyncButton } from "./CalendarSyncButton";

describe("CalendarSyncButton", () => {
  test("デフォルトではクリック可能でラベルは「同期」", () => {
    const onClick = vi.fn();
    render(
      <CalendarSyncButton
        isPending={false}
        lastSyncedAt={null}
        onClick={onClick}
      />,
    );

    const button = screen.getByRole("button", {
      name: "カレンダーを同期",
    }) as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    expect(button.textContent).toContain("同期");

    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  test("isPending=true のときは disabled / スピナー表示で「同期中...」", () => {
    const onClick = vi.fn();
    render(
      <CalendarSyncButton
        isPending={true}
        lastSyncedAt={null}
        onClick={onClick}
      />,
    );

    const button = screen.getByRole("button", {
      name: "カレンダーを同期",
    }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.textContent).toContain("同期中...");

    fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  test("lastSyncedAt があれば tooltip に最終同期時刻を出す", () => {
    render(
      <CalendarSyncButton
        isPending={false}
        lastSyncedAt={new Date().toISOString()}
        onClick={() => {}}
      />,
    );

    const button = screen.getByRole("button", { name: "カレンダーを同期" });
    // 厳密な文言は formatRelative 依存なので prefix だけ検査する
    expect(button.getAttribute("title")).toMatch(/^最終同期:/);
  });
});
