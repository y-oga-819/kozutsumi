const DAYS_JP = ["日", "月", "火", "水", "木", "金", "土"] as const;

export function formatDate(ds: string): string {
  const d = new Date(ds + "T00:00:00");
  return `${d.getMonth() + 1}/${d.getDate()} (${DAYS_JP[d.getDay()]})`;
}

export function timeToMin(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

/** ISO 8601 文字列からローカル時刻の 0:00 からの経過分数を取り出す。 */
export function minutesOfDay(iso: string): number {
  const d = new Date(iso);
  return d.getHours() * 60 + d.getMinutes();
}

/** ISO 8601 文字列をローカル時刻の "HH:MM" 表記に整形する。 */
export function formatClock(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** ISO 8601 文字列をローカル時刻の "YYYY-MM-DD" に整形する。 */
export function localDateOf(iso: string): string {
  const d = new Date(iso);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * ISO 8601 文字列を `<input type="datetime-local">` の value 形式 (`YYYY-MM-DDTHH:MM`)
 * にローカル時刻で整形する。タイムゾーン情報は落ちる (input は tz-naive)。
 */
export function toDateTimeLocalInput(iso: string): string {
  const d = new Date(iso);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}T${hh}:${mi}`;
}

/** ローカル時刻の今日を "YYYY-MM-DD" で返す。 */
export function todayIso(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

/** ローカル時刻の現在分数 (0:00 からの経過分数)。 */
export function nowMinutesOfDay(): number {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes();
}

export function fmtDuration(m: number): string {
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return rem === 0 ? `${h}h` : `${h}h${String(rem).padStart(2, "0")}m`;
}

export function fmtMin(m: number): string {
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`;
}

const MS_PER_MIN = 60 * 1000;
const MS_PER_HOUR = 60 * MS_PER_MIN;
const MS_PER_DAY = 24 * MS_PER_HOUR;

/** 依存イベントが「直近に迫っている」と判定する閾値 (24h)。タスクカードのハイライト判定に使う。 */
export const IMMINENT_THRESHOLD_MS = MS_PER_DAY;

function startOfLocalDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/**
 * イベント開始時刻までの相対表現。タスクカード上の依存イベント表示で使う。
 *
 * - 過ぎた / 1 分以内: 「もうすぐ」
 * - 1 時間未満: 「N分後」
 * - 同日内: 「今日 HH:MM」
 * - 翌日: 「明日 HH:MM」
 * - それ以降: 「M/D HH:MM」
 *
 * 閾値はパラメータレベルの判断のため ADR には残さず、ここの定数で管理する。
 */
export function formatRelativeTime(iso: string, now: Date = new Date()): string {
  const target = new Date(iso);
  const diffMs = target.getTime() - now.getTime();
  if (diffMs < MS_PER_MIN) return "もうすぐ";
  if (diffMs < MS_PER_HOUR) {
    const minutes = Math.round(diffMs / MS_PER_MIN);
    return `${minutes}分後`;
  }
  const dayDiff = Math.round((startOfLocalDay(target) - startOfLocalDay(now)) / MS_PER_DAY);
  const clock = formatClock(iso);
  if (dayDiff === 0) return `今日 ${clock}`;
  if (dayDiff === 1) return `明日 ${clock}`;
  return `${target.getMonth() + 1}/${target.getDate()} ${clock}`;
}
