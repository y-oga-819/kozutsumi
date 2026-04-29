import { render } from "@testing-library/react";
import { describe, expect, test } from "vitest";

import type { CorrectedEstimate as CorrectedEstimateValue } from "@/entities/task/correction";

import { CorrectedEstimate } from "./CorrectedEstimate";

/**
 * 補正後 + 元値の併記表示 (P3-9 / #93、ADR 0026) のレンダリング契約。
 *
 * ADR 0026 で禁止された表現 (取消線・矢印・「元」「補正後」「確保」等のラベル) が
 * 出ないことを踏む。これは PR レビュー時の「安直な表現に戻る」防止網。
 */

describe("CorrectedEstimate", () => {
  test("estimate=null のときは何も描画しない", () => {
    const { container } = render(<CorrectedEstimate estimate={null} variant="top" />);
    expect(container.firstChild).toBeNull();
  });

  test("補正なしは元値だけを faint で出す (現行 UI 後退無し)", () => {
    const estimate: CorrectedEstimateValue = {
      rawMinutes: 30,
      correctedMinutes: null,
      factor: null,
      sampleCount: null,
    };
    const { getByText, queryByText } = render(
      <CorrectedEstimate estimate={estimate} variant="top" />,
    );
    expect(getByText("30m")).toBeTruthy();
    // 補正値が無いので併記しない
    expect(queryByText("·")).toBeNull();
  });

  test("補正ありは『補正後 · 元値』の順で併記する", () => {
    const estimate: CorrectedEstimateValue = {
      rawMinutes: 30,
      correctedMinutes: 45,
      factor: 1.5,
      sampleCount: 10,
    };
    const { getByText } = render(<CorrectedEstimate estimate={estimate} variant="top" />);
    // 補正後と元値が両方表示される
    expect(getByText("45m")).toBeTruthy();
    expect(getByText("30m")).toBeTruthy();
    // 区切りは middle dot (取消線・矢印・括弧は使わない; ADR 0026)
    expect(getByText("·")).toBeTruthy();
  });

  test("ADR 0026: ラベル (元 / 補正後 / 確保 等) は表示しない", () => {
    const estimate: CorrectedEstimateValue = {
      rawMinutes: 30,
      correctedMinutes: 45,
      factor: 1.5,
      sampleCount: 10,
    };
    const { queryByText, container } = render(
      <CorrectedEstimate estimate={estimate} variant="top" />,
    );
    expect(queryByText(/補正/)).toBeNull();
    expect(queryByText(/^元/)).toBeNull();
    // 取消線 / 矢印が含まれていないことの軽い踏みつけ
    const html = container.innerHTML;
    expect(html).not.toMatch(/line-through/);
    expect(html).not.toMatch(/→/);
  });

  test("variant=row はサイズ階層を一段小さく出す", () => {
    const estimate: CorrectedEstimateValue = {
      rawMinutes: 30,
      correctedMinutes: null,
      factor: null,
      sampleCount: null,
    };
    const { container } = render(<CorrectedEstimate estimate={estimate} variant="row" />);
    expect(container.innerHTML).toMatch(/text-\[9px\]/);
  });

  test("variant=top は一段大きい (Stack View Top カード上ゾーン)", () => {
    const estimate: CorrectedEstimateValue = {
      rawMinutes: 30,
      correctedMinutes: null,
      factor: null,
      sampleCount: null,
    };
    const { container } = render(<CorrectedEstimate estimate={estimate} variant="top" />);
    expect(container.innerHTML).toMatch(/text-\[10px\]/);
  });
});
