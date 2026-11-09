export function deviceTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

export function isoWeekdayName(weekday: number): string {
  return WEEKDAYS[weekday - 1] ?? '';
}

const DATE_FORMAT: Intl.DateTimeFormatOptions = {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
};

/** "Mon 9 Nov 2026" for a local YYYY-MM-DD date. */
export function formatDay(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  const value = new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1);
  return value.toLocaleDateString(undefined, DATE_FORMAT);
}

/** "Mon 9 Nov 2026" for an ISO timestamp, in the device's time zone. */
export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, DATE_FORMAT);
}

export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}
