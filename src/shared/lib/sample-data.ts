const KEY = "kozutsumi.sample-data.v1";

export type SampleDataMode = "default" | "cleared";

export function readSampleDataMode(): SampleDataMode {
  if (typeof window === "undefined") return "default";
  try {
    return window.localStorage.getItem(KEY) === "cleared" ? "cleared" : "default";
  } catch {
    return "default";
  }
}

export function writeSampleDataMode(mode: SampleDataMode): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, mode);
  } catch {
    // localStorage 利用不可 (プライベートモード等) でも UI は動くよう黙殺
  }
}
