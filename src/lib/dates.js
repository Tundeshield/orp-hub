export function toDate(v) {
  if (!v) return null;
  if (v instanceof Date) return v;
  if (typeof v.toDate === 'function') return v.toDate();
  if (typeof v.seconds === 'number') return new Date(v.seconds * 1000);
  const d = new Date(v);
  return isNaN(d) ? null : d;
}

export function fmtDate(v, opts = {}) {
  const d = toDate(v);
  if (!d) return '—';
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', ...opts });
}

export function fmtDateTime(v) {
  const d = toDate(v);
  if (!d) return '—';
  return d.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export function fmtTime(v) {
  const d = toDate(v);
  if (!d) return '—';
  return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

export function isOverdue(due, now = new Date()) {
  const d = toDate(due);
  return !!d && d < now;
}

export function startOfDay(d = new Date()) {
  const x = new Date(d); x.setHours(0, 0, 0, 0); return x;
}

export function addDays(d, n) {
  const x = new Date(d); x.setDate(x.getDate() + n); return x;
}

// "2026-10-14" input value from a Date
export function toInputDate(v) {
  const d = toDate(v);
  if (!d) return '';
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function fromInputDate(s, endOfDay = false) {
  if (!s) return null;
  const [y, m, d] = s.split('-').map(Number);
  return endOfDay ? new Date(y, m - 1, d, 23, 59, 59) : new Date(y, m - 1, d);
}

export function relative(v, now = new Date()) {
  const d = toDate(v);
  if (!d) return '';
  const days = Math.round((startOfDay(d) - startOfDay(now)) / 86400000);
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  if (days === -1) return 'yesterday';
  return days > 0 ? `in ${days} days` : `${-days} days ago`;
}
