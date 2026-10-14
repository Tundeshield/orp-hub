import { describe, it, expect } from 'vitest';
import { generateSlots, overlaps, withoutConflicts } from './slots.js';

describe('slots', () => {
  const day = new Date(2026, 10, 2);
  it('generates fixed-length slots inside the window', () => {
    const s = generateSlots(day, '10:00', '12:00', 30);
    expect(s).toHaveLength(4);
    expect(s[0].start.getHours()).toBe(10);
    expect(s[3].end.getHours()).toBe(12);
  });
  it('drops a trailing partial slot', () => {
    expect(generateSlots(day, '10:00', '11:15', 30)).toHaveLength(2);
  });
  it('detects overlaps but not touching edges', () => {
    const t = (h, m = 0) => new Date(2026, 10, 2, h, m);
    expect(overlaps(t(10), t(11), t(10, 30), t(11, 30))).toBe(true);
    expect(overlaps(t(10), t(11), t(11), t(12))).toBe(false);
  });
  it('never proposes a slot that clashes with an existing one (no double-booking of time)', () => {
    const existing = [{ start: new Date(2026, 10, 2, 10, 15), end: new Date(2026, 10, 2, 10, 45) }];
    const fresh = withoutConflicts(generateSlots(day, '10:00', '12:00', 30), existing);
    expect(fresh.map((x) => x.start.getHours() * 60 + x.start.getMinutes())).toEqual([660, 690]);
  });
});
