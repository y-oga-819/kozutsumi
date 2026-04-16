import { describe, expect, test } from "vitest";
import { findDropTarget } from "./findDropTarget.js";

const rects = [
  { top: 0, height: 50 }, // 中心 25
  { top: 50, height: 50 }, // 中心 75
  { top: 100, height: 50 }, // 中心 125
];

describe("findDropTarget", () => {
  test("最初の要素の中心より上なら 0", () => {
    expect(findDropTarget(10, rects)).toBe(0);
    expect(findDropTarget(24, rects)).toBe(0);
  });

  test("1番目の中心を超えたら 1", () => {
    expect(findDropTarget(30, rects)).toBe(1);
    expect(findDropTarget(74, rects)).toBe(1);
  });

  test("2番目の中心を超えたら 2", () => {
    expect(findDropTarget(80, rects)).toBe(2);
  });

  test("全要素の下にあれば最後のインデックス", () => {
    expect(findDropTarget(200, rects)).toBe(2);
  });

  test("null / undefined の要素はスキップ", () => {
    const r = [{ top: 0, height: 50 }, null, { top: 100, height: 50 }];
    // clientY=60: 25 を超えたが null はスキップ、125 未満なので 2
    expect(findDropTarget(60, r)).toBe(2);
  });

  test("空配列は -1", () => {
    expect(findDropTarget(0, [])).toBe(-1);
  });
});
