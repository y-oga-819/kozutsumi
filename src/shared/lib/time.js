const DAYS_JP = ["日", "月", "火", "水", "木", "金", "土"];

export function formatDate(ds) {
  const d = new Date(ds + "T00:00:00");
  return `${d.getMonth() + 1}/${d.getDate()} (${DAYS_JP[d.getDay()]})`;
}

export function timeToMin(t) {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

export function fmtDuration(m) {
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return rem === 0 ? `${h}h` : `${h}h${String(rem).padStart(2, "0")}m`;
}

export function fmtMin(m) {
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`;
}
