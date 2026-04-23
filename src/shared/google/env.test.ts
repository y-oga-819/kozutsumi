import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { getGoogleOAuthEnv } from "./env";

describe("getGoogleOAuthEnv", () => {
  const original = {
    clientId: process.env.GOOGLE_OAUTH_CLIENT_ID,
    clientSecret: process.env.GOOGLE_OAUTH_CLIENT_SECRET,
  };

  beforeEach(() => {
    delete process.env.GOOGLE_OAUTH_CLIENT_ID;
    delete process.env.GOOGLE_OAUTH_CLIENT_SECRET;
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
  });

  test("両方揃っていれば値を返す", () => {
    process.env.GOOGLE_OAUTH_CLIENT_ID = "id-123";
    process.env.GOOGLE_OAUTH_CLIENT_SECRET = "secret-xyz";

    expect(getGoogleOAuthEnv()).toEqual({
      clientId: "id-123",
      clientSecret: "secret-xyz",
    });
  });

  test("GOOGLE_OAUTH_CLIENT_ID が無ければ throw", () => {
    process.env.GOOGLE_OAUTH_CLIENT_SECRET = "secret-xyz";
    expect(() => getGoogleOAuthEnv()).toThrow(/GOOGLE_OAUTH_CLIENT_ID/);
  });

  test("GOOGLE_OAUTH_CLIENT_SECRET が無ければ throw", () => {
    process.env.GOOGLE_OAUTH_CLIENT_ID = "id-123";
    expect(() => getGoogleOAuthEnv()).toThrow(/GOOGLE_OAUTH_CLIENT_SECRET/);
  });
});
