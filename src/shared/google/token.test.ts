import type { SupabaseClient } from "@supabase/supabase-js";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from "vitest";

import {
  getValidAccessToken,
  ProviderTokenMissingError,
  RefreshTokenExpiredError,
  refreshAccessToken,
} from "./token";

type SessionShape = {
  provider_token?: string | null;
  provider_refresh_token?: string | null;
};

function makeSupabase(session: SessionShape | null): SupabaseClient {
  return {
    auth: {
      getSession: vi.fn(async () => ({
        data: { session },
        error: null,
      })),
    },
  } as unknown as SupabaseClient;
}

const original = {
  clientId: process.env.GOOGLE_OAUTH_CLIENT_ID,
  clientSecret: process.env.GOOGLE_OAUTH_CLIENT_SECRET,
  fetch: globalThis.fetch,
};

beforeEach(() => {
  process.env.GOOGLE_OAUTH_CLIENT_ID = "test-client-id";
  process.env.GOOGLE_OAUTH_CLIENT_SECRET = "test-client-secret";
  globalThis.fetch = vi.fn();
});

afterEach(() => {
  if (original.clientId === undefined) {
    delete process.env.GOOGLE_OAUTH_CLIENT_ID;
  } else {
    process.env.GOOGLE_OAUTH_CLIENT_ID = original.clientId;
  }
  if (original.clientSecret === undefined) {
    delete process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  } else {
    process.env.GOOGLE_OAUTH_CLIENT_SECRET = original.clientSecret;
  }
  globalThis.fetch = original.fetch;
  vi.restoreAllMocks();
});

describe("getValidAccessToken", () => {
  test("session に provider_token と refresh_token があれば返す", async () => {
    const supabase = makeSupabase({
      provider_token: "access-1",
      provider_refresh_token: "refresh-1",
    });

    await expect(getValidAccessToken(supabase)).resolves.toEqual({
      accessToken: "access-1",
      refreshToken: "refresh-1",
    });
  });

  test("session が無ければ ProviderTokenMissingError", async () => {
    const supabase = makeSupabase(null);
    await expect(getValidAccessToken(supabase)).rejects.toBeInstanceOf(
      ProviderTokenMissingError,
    );
  });

  test("provider_token が無ければ ProviderTokenMissingError", async () => {
    const supabase = makeSupabase({
      provider_token: null,
      provider_refresh_token: "refresh-1",
    });
    await expect(getValidAccessToken(supabase)).rejects.toBeInstanceOf(
      ProviderTokenMissingError,
    );
  });

  test("provider_refresh_token が無ければ ProviderTokenMissingError", async () => {
    const supabase = makeSupabase({
      provider_token: "access-1",
      provider_refresh_token: null,
    });
    await expect(getValidAccessToken(supabase)).rejects.toBeInstanceOf(
      ProviderTokenMissingError,
    );
  });
});

describe("refreshAccessToken", () => {
  test("Google OAuth token endpoint に refresh_token で POST し、新 access_token を返す", async () => {
    const supabase = makeSupabase({
      provider_token: "old-access",
      provider_refresh_token: "refresh-1",
    });
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          access_token: "new-access",
          expires_in: 3600,
          token_type: "Bearer",
        }),
        { status: 200 },
      ),
    );

    const result = await refreshAccessToken(supabase);

    expect(result).toEqual({
      accessToken: "new-access",
      refreshToken: "refresh-1",
    });

    const [url, init] = vi.mocked(globalThis.fetch).mock.calls[0]!;
    expect(String(url)).toBe("https://oauth2.googleapis.com/token");
    expect(init?.method).toBe("POST");
    const body = new URLSearchParams(String(init?.body));
    expect(body.get("grant_type")).toBe("refresh_token");
    expect(body.get("refresh_token")).toBe("refresh-1");
    expect(body.get("client_id")).toBe("test-client-id");
    expect(body.get("client_secret")).toBe("test-client-secret");
  });

  test("Google がローテーションで新 refresh_token を返したら置き換える", async () => {
    const supabase = makeSupabase({
      provider_token: "old-access",
      provider_refresh_token: "refresh-1",
    });
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          access_token: "new-access",
          refresh_token: "refresh-2",
        }),
        { status: 200 },
      ),
    );

    const result = await refreshAccessToken(supabase);
    expect(result).toEqual({
      accessToken: "new-access",
      refreshToken: "refresh-2",
    });
  });

  test("refresh が 400 (invalid_grant) で RefreshTokenExpiredError", async () => {
    const supabase = makeSupabase({
      provider_token: "old-access",
      provider_refresh_token: "refresh-1",
    });
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({ error: "invalid_grant" }),
        { status: 400 },
      ),
    );

    await expect(refreshAccessToken(supabase)).rejects.toBeInstanceOf(
      RefreshTokenExpiredError,
    );
  });

  test("session が無ければ ProviderTokenMissingError で Google を叩かない", async () => {
    const supabase = makeSupabase(null);

    await expect(refreshAccessToken(supabase)).rejects.toBeInstanceOf(
      ProviderTokenMissingError,
    );
    expect(vi.mocked(globalThis.fetch)).not.toHaveBeenCalled();
  });

  test("provider_refresh_token が無ければ ProviderTokenMissingError で Google を叩かない", async () => {
    const supabase = makeSupabase({
      provider_token: "old-access",
      provider_refresh_token: null,
    });

    await expect(refreshAccessToken(supabase)).rejects.toBeInstanceOf(
      ProviderTokenMissingError,
    );
    expect(vi.mocked(globalThis.fetch)).not.toHaveBeenCalled();
  });
});
