import { describe, it, expect } from 'vitest';
import { consolidate, STANDARD_TEMPLATES } from './reportTemplates.js';

describe('consolidate', () => {
  const fields = STANDARD_TEMPLATES[0].fields;
  const reports = [
    { status: 'submitted', ministryName: 'Youth', answers: { avg_attendance: '40', new_members: '3', challenges: 'Venue' } },
    { status: 'reviewed', ministryName: 'Choir', answers: { avg_attendance: 25, new_members: 1, challenges: '' } },
    { status: 'pending', ministryName: 'Ushers', answers: { avg_attendance: 99 } },
  ];
  it('sums only submitted/reviewed numeric answers', () => {
    const c = consolidate(reports, fields);
    const att = c.numeric.find((f) => f.key === 'avg_attendance');
    expect(att.total).toBe(65);
    expect(att.average).toBe(32.5);
    expect(c.rows).toHaveLength(2);
  });
  it('collects non-empty text answers by ministry', () => {
    const c = consolidate(reports, fields);
    expect(c.text.find((f) => f.key === 'challenges').answers).toEqual([{ ministry: 'Youth', value: 'Venue' }]);
  });
});
