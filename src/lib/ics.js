import { toDate } from './dates.js';

const stamp = (d) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

// A calendar file with a 1-hour and a 1-day reminder, so phones remind people for free.
export function appointmentICS({ id, title, description, start, end, location }) {
  const s = toDate(start), e = toDate(end);
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Pastor's Desk//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${id}@orp-hub`,
    `DTSTAMP:${stamp(new Date())}`,
    `DTSTART:${stamp(s)}`,
    `DTEND:${stamp(e)}`,
    `SUMMARY:${(title || '').replace(/\n/g, ' ')}`,
    `DESCRIPTION:${(description || '').replace(/\n/g, '\\n')}`,
    location ? `LOCATION:${location}` : null,
    'BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:Reminder', 'TRIGGER:-PT1H', 'END:VALARM',
    'BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:Reminder', 'TRIGGER:-P1D', 'END:VALARM',
    'END:VEVENT', 'END:VCALENDAR',
  ].filter(Boolean);
  return lines.join('\r\n');
}
