/**
 * task_size (主観サイズ) の代表分マッピング (ADR 0036 / 0038, #169)。
 *
 * task_size は「ユーザーが感じた粗いサイズ」を 7 段階で表す主観値であり、AI 推定の
 * `estimated_minutes` とは独立した軸。両者は別シグナルとして並存させる (ADR 0038)。
 *
 * 本マッピングは「主観値を分単位の代表値に倒す」必要が出た場面 (例: TaskForm が
 * task_size を選んだとき estimated_minutes の初期値を提示する) でのみ使う。
 * 補正エンジン (ADR 0024〜0026) の入力には使わない (補正は estimated_minutes 軸のまま)。
 *
 * `large` は「半日超 / 終日では括れない大物」を表すため代表分は付けない (null)。
 * 代表値で括ると行動分析時に large の主観 vs 実所要の分布が潰れる。
 */
import type { TaskSizeValue } from "@/shared/types/database";

export const TASK_SIZE_TO_MINUTES: Record<TaskSizeValue, number | null> = {
  "15m": 15,
  "30m": 30,
  "1h": 60,
  "2h": 120,
  "4h": 240,
  "1d": 480,
  large: null,
};

/**
 * task_size の UI 表示ラベル (#170, ADR 0038)。
 *
 * TaskForm の 7 段階ボタン / TaskDetailPanel の編集 select / 一覧表示で使う。
 * `large` は「1 日では括れない大物」を表すため、他の段階と並んだときに「半日超」
 * と分かる文言にする (ADR 0038 Notes 「`large` の表示文言は実装で詰める」)。
 */
export const TASK_SIZE_LABELS: Record<TaskSizeValue, string> = {
  "15m": "15分",
  "30m": "30分",
  "1h": "1時間",
  "2h": "2時間",
  "4h": "半日",
  "1d": "1日",
  large: "1日超",
};
