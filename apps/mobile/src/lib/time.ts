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

/** "Mon 9 Nov" for a local YYYY-MM-DD date. */
export function formatDay(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  const value = new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1);
  return value.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
}

/** "Mon 9 Nov" for an ISO timestamp, in the device's time zone. */
export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
}

export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}
