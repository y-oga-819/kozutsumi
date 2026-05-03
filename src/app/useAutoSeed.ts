"use client";

import { useEffect, useRef } from "react";

import { type SeedGateways, seedSampleData } from "@/mocks/seed";
import { readSampleDataMode, writeSampleDataMode } from "@/shared/lib/sample-data";

type UseAutoSeedArgs = {
  /** 全 query (projects/tasks/events) が success に到達したか。false の間は何もしない。 */
  ready: boolean;
  /** projects / tasks / events が全て空か。false なら何もしない。 */
  isEmpty: boolean;
  gateways: SeedGateways;
  /** seed 完了後に呼ぶ (AppShell では projects/tasks/events を invalidate する)。 */
  onSeeded: () => Promise<void>;
};

/**
 * 初回ログイン時の自動サンプル seed を担う effect hook。
 *
 * - 全テーブル空かつ「cleared」フラグが立っていない場合のみ投入
 * - ref ガードでストリクトモードでの 2 重 fire を防ぐ
 * - 失敗時は再試行ループに入らないよう ref を立てたまま (ユーザー明示操作で再試行できる)
 */
export function useAutoSeed({ ready, isEmpty, gateways, onSeeded }: UseAutoSeedArgs): void {
  const seedingRef = useRef(false);

  useEffect(() => {
    if (seedingRef.current) return;
    if (!ready) return;
    if (readSampleDataMode() === "cleared") return;
    if (!isEmpty) return;
    seedingRef.current = true;
    seedSampleData(gateways)
      .then(() => {
        writeSampleDataMode("default");
        return onSeeded();
      })
      .catch((err) => {
        console.error("[seed] failed", err);
      });
  }, [ready, isEmpty, gateways, onSeeded]);
}
