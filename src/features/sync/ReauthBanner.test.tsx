import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

type SignInWithOAuthArgs = {
  provider: string;
  options: {
    redirectTo: string;
    scopes: string;
    queryParams: Record<string, string>;
  };
};
const signInWithOAuthMock = vi.fn<
  (args: SignInWithOAuthArgs) => Promise<{ error: null }>
>(async () => ({ error: null }));
vi.mock("@/shared/supabase/client", () => ({
  createClient: () => ({
    auth: {
      signInWithOAuth: signInWithOAuthMock,
    },
  }),
}));

import { ReauthBanner } from "./ReauthBanner";

describe("ReauthBanner", () => {
  beforeEach(() => {
    signInWithOAuthMock.mockClear();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("visible=false のときは何も描画しない", () => {
    const { container } = render(
      <ReauthBanner visible={false} onDismiss={() => {}} />,
    );
    expect(container.firstChild).toBeNull();
  });

  test("visible=true のとき alert と再連携ボタンを出す", () => {
    render(<ReauthBanner visible={true} onDismiss={() => {}} />);
    expect(screen.getByRole("alert")).not.toBeNull();
    expect(
      screen.getByRole("button", { name: /Google と連携し直す/ }),
    ).not.toBeNull();
  });

  test("再連携ボタンで signInWithOAuth を Google + calendar.readonly scope で起動する", () => {
    render(<ReauthBanner visible={true} onDismiss={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /Google と連携し直す/ }));

    expect(signInWithOAuthMock).toHaveBeenCalledTimes(1);
    const args = signInWithOAuthMock.mock.calls[0]![0];
    expect(args.provider).toBe("google");
    expect(args.options.scopes).toContain(
      "https://www.googleapis.com/auth/calendar.readonly",
    );
    expect(args.options.queryParams).toEqual({
      access_type: "offline",
      prompt: "consent",
    });
    expect(args.options.redirectTo).toMatch(/\/auth\/callback$/);
  });

  test("閉じるボタンで onDismiss を呼ぶ", () => {
    const onDismiss = vi.fn();
    render(<ReauthBanner visible={true} onDismiss={onDismiss} />);
    fireEvent.click(screen.getByRole("button", { name: "バナーを閉じる" }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
