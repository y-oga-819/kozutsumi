import { describe, expect, test } from "vitest";
import type { Event } from "../../entities/event/types";
import { buildSlots, computeDayBounds } from "./buildSlots";

const ev = (
  id: string,
  start: string,
  end: string,
  projectId: Event["projectId"] = "slo",
): Event => ({
  id,
  title: `ev ${id}`,
  startTime: `2026-04-11T${start}:00`,
  endTime: `2026-04-11T${end}:00`,
  projectId,
  meetUrl: null,
  hasAttachments: false,
  description: "",
  source: "manual",
  externalId: null,
  createdAt: "2026-04-11T00:00:00",
});

describe("computeDayBounds", () => {
  test("イベントなし & nowMin=10時 → 9:00-18:00 が基本範囲", () => {
    expect(computeDayBounds([], 10 * 60)).toEqual({
      dayStart: 9 * 60,
      dayEnd: 18 * 60,
    });
  });

  test("早朝イベントがあれば dayStart が切り下げられる", () => {
    const events = [ev("e1", "07:30", "08:00")];
    expect(computeDayBounds(events, 10 * 60).dayStart).toBe(7 * 60);
  });

  test("深夜イベントがあれば dayEnd が切り上げられる", () => {
    const events = [ev("e1", "21:00", "23:00")];
    expect(computeDayBounds(events, 10 * 60).dayEnd).toBe(23 * 60);
  });

  test("nowMin が 18:00 を超えれば dayEnd も切り上げられる", () => {
    expect(computeDayBounds([], 19 * 60 + 30).dayEnd).toBe(20 * 60);
  });

  test("時間単位に丸める (dayStart は floor, dayEnd は ceil)", () => {
    expect(computeDayBounds([ev("e1", "07:15", "07:45")], 10 * 60).dayStart).toBe(7 * 60);
    expect(computeDayBounds([ev("e1", "22:15", "22:45")], 10 * 60).dayEnd).toBe(23 * 60);
  });
});

describe("buildSlots", () => {
  test("イベント無しなら 1つの free スロット", () => {
    const slots = buildSlots([], 9 * 60, 18 * 60);
    expect(slots).toEqual([{ type: "free", start: 9 * 60, end: 18 * 60, duration: 9 * 60 }]);
  });

  test("1つのイベントは free / event / free の3スロットに分割される", () => {
    const events = [ev("e1", "10:00", "11:00")];
    const slots = buildSlots(events, 9 * 60, 18 * 60);
    expect(slots.map((s) => s.type)).toEqual(["free", "event", "free"]);
    expect(slots[1].type === "event" && slots[1].event.id).toBe("e1");
  });

  test("dayStart と同時刻に始まるイベントは先頭に free を挿入しない", () => {
    const events = [ev("e1", "09:00", "10:00")];
    const slots = buildSlots(events, 9 * 60, 18 * 60);
    expect(slots[0].type).toBe("event");
  });

  test("dayEnd と同時刻に終わるイベントは末尾に free を挿入しない", () => {
    const events = [ev("e1", "17:00", "18:00")];
    const slots = buildSlots(events, 9 * 60, 18 * 60);
    expect(slots[slots.length - 1].type).toBe("event");
  });

  test("連続する2つのイベント → free / event / event / free", () => {
    const events = [ev("e1", "10:00", "11:00"), ev("e2", "11:00", "12:00")];
    const slots = buildSlots(events, 9 * 60, 18 * 60);
    expect(slots.map((s) => s.type)).toEqual(["free", "event", "event", "free"]);
  });

  test("時刻順でない入力も開始時刻順にソートされる", () => {
    const events = [ev("e2", "14:00", "15:00"), ev("e1", "10:00", "11:00")];
    const slots = buildSlots(events, 9 * 60, 18 * 60);
    const eventIds = slots
      .filter((s): s is import("./buildSlots").EventSlot => s.type === "event")
      .map((s) => s.event.id);
    expect(eventIds).toEqual(["e1", "e2"]);
  });

  test("各スロットは start / end / duration を持つ", () => {
    const events = [ev("e1", "10:00", "11:30")];
    const slots = buildSlots(events, 9 * 60, 12 * 60);
    expect(slots[0]).toMatchObject({ start: 540, end: 600, duration: 60 });
    expect(slots[1]).toMatchObject({ start: 600, end: 690, duration: 90 });
    expect(slots[2]).toMatchObject({ start: 690, end: 720, duration: 30 });
  });
});
