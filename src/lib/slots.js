import { toDate } from './dates.js';

// True when [aStart,aEnd) overlaps [bStart,bEnd)
export function overlaps(aStart, aEnd, bStart, bEnd) {
  const as = toDate(aStart).getTime(), ae = toDate(aEnd).getTime();
  const bs = toDate(bStart).getTime(), be = toDate(bEnd).getTime();
  return as < be && bs < ae;
}

// Generate slots of `minutes` length between from/to times on a given date.
export function generateSlots(date, fromHHMM, toHHMM, minutes) {
  const [fh, fm] = fromHHMM.split(':').map(Number);
  const [th, tm] = toHHMM.split(':').map(Number);
  const start = new Date(date); start.setHours(fh, fm, 0, 0);
  const end = new Date(date); end.setHours(th, tm, 0, 0);
  const out = [];
  for (let t = start.getTime(); t + minutes * 60000 <= end.getTime(); t += minutes * 60000) {
    out.push({ start: new Date(t), end: new Date(t + minutes * 60000) });
  }
  return out;
}

// Drop proposed slots that clash with existing (non-deleted) slots.
export function withoutConflicts(proposed, existing) {
  return proposed.filter((p) => !existing.some((e) => overlaps(p.start, p.end, e.start, e.end)));
}
