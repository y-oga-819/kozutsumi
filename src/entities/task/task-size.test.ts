import { describe, expect, test } from "vitest";

import { TASK_SIZE_VALUES } from "@/shared/types/database";

import { TASK_SIZE_TO_MINUTES } from "./task-size";

describe("TASK_SIZE_TO_MINUTES (#169 / ADR 0038)", () => {
  test("各値域に代表分または null を割り当てる", () => {
    expect(TASK_SIZE_TO_MINUTES["15m"]).toBe(15);
    expect(TASK_SIZE_TO_MINUTES["30m"]).toBe(30);
    expect(TASK_SIZE_TO_MINUTES["1h"]).toBe(60);
    expect(TASK_SIZE_TO_MINUTES["2h"]).toBe(120);
    expect(TASK_SIZE_TO_MINUTES["4h"]).toBe(240);
    expect(TASK_SIZE_TO_MINUTES["1d"]).toBe(480);
    // 'large' は代表分で括ると行動分析時に分布が潰れるため null を返す
    expect(TASK_SIZE_TO_MINUTES.large).toBeNull();
  });

  test("値域 (TASK_SIZE_VALUES) すべてに対応エントリが存在する", () => {
    for (const v of TASK_SIZE_VALUES) {
      expect(TASK_SIZE_TO_MINUTES).toHaveProperty(v);
    }
  });
});
