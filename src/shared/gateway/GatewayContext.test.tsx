import { renderHook } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import {
  useEventGateway,
  useProjectGateway,
  useTaskGateway,
  useTaskTimeEntryGateway,
} from "./GatewayContext";

describe("GatewayContext hooks — Provider 未提供時", () => {
  test("useTaskGateway は Provider 無しで throw する", () => {
    const suppress = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(() => renderHook(() => useTaskGateway())).toThrowError(
        /GatewayProvider/,
      );
    } finally {
      suppress.mockRestore();
    }
  });

  test("useProjectGateway は Provider 無しで throw する", () => {
    const suppress = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(() => renderHook(() => useProjectGateway())).toThrowError(
        /GatewayProvider/,
      );
    } finally {
      suppress.mockRestore();
    }
  });

  test("useEventGateway は Provider 無しで throw する", () => {
    const suppress = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(() => renderHook(() => useEventGateway())).toThrowError(
        /GatewayProvider/,
      );
    } finally {
      suppress.mockRestore();
    }
  });

  test("useTaskTimeEntryGateway は Provider 無しで throw する", () => {
    const suppress = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(() => renderHook(() => useTaskTimeEntryGateway())).toThrowError(
        /GatewayProvider/,
      );
    } finally {
      suppress.mockRestore();
    }
  });
});
