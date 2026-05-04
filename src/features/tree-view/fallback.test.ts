import { describe, expect, test } from "vitest";

import type { Project } from "@/entities/project/types";

import { computeProjectOrderForTree, mergeTreeProjects } from "./fallback";

const project = (id: string, overrides: Partial<Project> = {}): Project => ({
  id,
  name: id,
  color: "#000",
  isPrimary: false,
  createdAt: "",
  ...overrides,
});

describe("mergeTreeProjects", () => {
  test("既知 slug は fallback で補完される", () => {
    const result = mergeTreeProjects([], [{ projectId: "career" }, { projectId: "slo" }]);
    expect(result.map((p) => p.id)).toEqual(["career", "slo"]);
    expect(result.find((p) => p.id === "career")?.name).toBe("転職活動");
    expect(result.find((p) => p.id === "slo")?.name).toBe("SLO推進");
  });

  test("未知 slug は素の id で補完される", () => {
    const result = mergeTreeProjects([], [{ projectId: "unknown-slug" }]);
    expect(result.map((p) => p.id)).toEqual(["unknown-slug"]);
    expect(result[0]?.name).toBe("unknown-slug");
  });

  test("DB にある projects はそのまま、足りない slug だけ末尾に追加される", () => {
    const dbProjects = [project("real")];
    const result = mergeTreeProjects(dbProjects, [{ projectId: "real" }, { projectId: "career" }]);
    expect(result.map((p) => p.id)).toEqual(["real", "career"]);
  });

  test("history の重複 projectId は重複追加しない", () => {
    const result = mergeTreeProjects(
      [],
      [{ projectId: "career" }, { projectId: "career" }, { projectId: "slo" }],
    );
    expect(result.map((p) => p.id)).toEqual(["career", "slo"]);
  });
});

describe("computeProjectOrderForTree", () => {
  test("DB に projects があればその id 順", () => {
    const dbProjects = [project("a"), project("b"), project("c")];
    expect(computeProjectOrderForTree(dbProjects, [{ projectId: "z" }])).toEqual(["a", "b", "c"]);
  });

  test("DB が空なら history の projectId 順 (重複排除)", () => {
    const order = computeProjectOrderForTree(
      [],
      [{ projectId: "career" }, { projectId: "slo" }, { projectId: "career" }],
    );
    expect(order).toEqual(["career", "slo"]);
  });
});
