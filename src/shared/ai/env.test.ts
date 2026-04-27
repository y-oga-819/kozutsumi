import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { getGeminiApiKey, isAiEnabled } from "./env";

describe("isAiEnabled", () => {
  const original = {
    aiEnabled: process.env.AI_ENABLED,
    geminiApiKey: process.env.GEMINI_API_KEY,
  };

  beforeEach(() => {
    delete process.env.AI_ENABLED;
    delete process.env.GEMINI_API_KEY;
  });

  afterEach(() => {
    if (original.aiEnabled === undefined) {
      delete process.env.AI_ENABLED;
    } else {
      process.env.AI_ENABLED = original.aiEnabled;
    }
    if (original.geminiApiKey === undefined) {
      delete process.env.GEMINI_API_KEY;
    } else {
      process.env.GEMINI_API_KEY = original.geminiApiKey;
    }
  });

  test("AI_ENABLED が未設定なら false", () => {
    process.env.GEMINI_API_KEY = "k";
    expect(isAiEnabled()).toBe(false);
  });

  test('AI_ENABLED が "true" 以外なら false (例: "1")', () => {
    process.env.AI_ENABLED = "1";
    process.env.GEMINI_API_KEY = "k";
    expect(isAiEnabled()).toBe(false);
  });

  test("AI_ENABLED=true でも GEMINI_API_KEY が無ければ false (fail-soft)", () => {
    process.env.AI_ENABLED = "true";
    expect(isAiEnabled()).toBe(false);
  });

  test("両方揃っていれば true", () => {
    process.env.AI_ENABLED = "true";
    process.env.GEMINI_API_KEY = "k";
    expect(isAiEnabled()).toBe(true);
  });
});

describe("getGeminiApiKey", () => {
  const original = process.env.GEMINI_API_KEY;

  beforeEach(() => {
    delete process.env.GEMINI_API_KEY;
  });

  afterEach(() => {
    if (original === undefined) {
      delete process.env.GEMINI_API_KEY;
    } else {
      process.env.GEMINI_API_KEY = original;
    }
  });

  test("値があれば返す", () => {
    process.env.GEMINI_API_KEY = "key-abc";
    expect(getGeminiApiKey()).toBe("key-abc");
  });

  test("無ければ throw", () => {
    expect(() => getGeminiApiKey()).toThrow(/GEMINI_API_KEY/);
  });
});
