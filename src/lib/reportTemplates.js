// Standard ministry reporting templates. Installed from Admin → Report templates.
export const STANDARD_TEMPLATES = [
  {
    name: 'Monthly Ministry Report',
    frequency: 'monthly',
    description: 'Standard monthly report from every ministry/department leader.',
    fields: [
      { key: 'avg_attendance', label: 'Average attendance at meetings', type: 'number' },
      { key: 'meetings_held', label: 'Number of meetings / activities held', type: 'number' },
      { key: 'new_members', label: 'New members joined', type: 'number' },
      { key: 'activities', label: 'Key activities this month', type: 'textarea' },
      { key: 'achievements', label: 'Achievements and testimonies', type: 'textarea' },
      { key: 'challenges', label: 'Challenges / issues needing attention', type: 'textarea' },
      { key: 'needs', label: 'Requests to the Resident Pastor', type: 'textarea' },
      { key: 'next_plans', label: 'Plans for next month', type: 'textarea' },
    ],
  },
  {
    name: 'Event / Programme Report',
    frequency: 'adhoc',
    description: 'After a special programme, outreach or event.',
    fields: [
      { key: 'event_name', label: 'Event name', type: 'text' },
      { key: 'attendance', label: 'Total attendance', type: 'number' },
      { key: 'first_timers', label: 'First-timers', type: 'number' },
      { key: 'decisions', label: 'Salvation / commitment decisions', type: 'number' },
      { key: 'summary', label: 'Summary of what happened', type: 'textarea' },
      { key: 'issues', label: 'Issues and lessons learned', type: 'textarea' },
      { key: 'followup', label: 'Follow-up required', type: 'textarea' },
    ],
  },
  {
    name: 'Quarterly Ministry Review',
    frequency: 'quarterly',
    description: 'Quarterly review of goals, people and resources.',
    fields: [
      { key: 'active_workers', label: 'Active workers in the ministry', type: 'number' },
      { key: 'goals_met', label: 'Goals achieved this quarter', type: 'textarea' },
      { key: 'goals_missed', label: 'Goals not achieved, and why', type: 'textarea' },
      { key: 'people', label: 'People / leadership concerns', type: 'textarea' },
      { key: 'resources', label: 'Resource and budget needs', type: 'textarea' },
      { key: 'next_goals', label: 'Goals for next quarter', type: 'textarea' },
    ],
  },
];

// Consolidates submitted/reviewed reports into totals and per-ministry answers.
export function consolidate(reports, fields) {
  const rows = reports.filter((r) => ['submitted', 'reviewed'].includes(r.status));
  const numeric = fields.filter((f) => f.type === 'number').map((f) => {
    const values = rows.map((r) => Number(r.answers?.[f.key])).filter((n) => Number.isFinite(n));
    const total = values.reduce((a, b) => a + b, 0);
    return { ...f, total, average: values.length ? Math.round((total / values.length) * 10) / 10 : 0, count: values.length };
  });
  const text = fields.filter((f) => f.type !== 'number').map((f) => ({
    ...f,
    answers: rows.map((r) => ({ ministry: r.ministryName, value: (r.answers?.[f.key] || '').trim() })).filter((a) => a.value),
  }));
  return { rows, numeric, text };
}
