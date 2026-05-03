"use client";

import { useEffect, useMemo, useState } from "react";

/**
 * SSR / mount 前の placeholder として使う「分単位の今」。朝 9 時を仮置きし、
 * `nowMin` を初期描画時に DayTimeline 等に渡しても極端に違和感が出ないようにする。
 * mount 後は実際の `Date.now()` で上書きされるため、最終 UI に残らない。
 */
const SSR_PLACEHOLDER_MIN_OF_DAY = 9 * 60;

/** 1 分間隔の tick (ms)。DayTimeline の「今」位置が分単位で動けば十分。 */
const TICK_INTERVAL_MS = 60_000;

export type NowClock = {
  /** ms epoch。SSR 時は 0、mount 後は実時刻。hydration mismatch 回避用に 0 sentinel を使う。 */
  nowMs: number;
  /** 0:00 起算の分数 (HH*60+MM)。SSR 時は SSR_PLACEHOLDER_MIN_OF_DAY。 */
  nowMin: number;
};

/**
 * SSR セーフな「今」hook。mount 前は 0/`9 * 60` の placeholder を返し、mount 後は
 * 1 分ごとに実時刻に追従する。AppShell が `nowMs` を依存イベント比較・タイマー bind に、
 * `nowMin` をタイムライン描画に使う。
 */
export function useNowClock(): NowClock {
  const [nowMs, setNowMs] = useState<number>(0);

  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect */
    setNowMs(Date.now());
    /* eslint-enable react-hooks/set-state-in-effect */
    const id = window.setInterval(() => setNowMs(Date.now()), TICK_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, []);

  const nowMin = useMemo(() => {
    if (nowMs === 0) return SSR_PLACEHOLDER_MIN_OF_DAY;
    const d = new Date(nowMs);
    return d.getHours() * 60 + d.getMinutes();
  }, [nowMs]);

  return { nowMs, nowMin };
}
