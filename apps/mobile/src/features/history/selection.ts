import type { HistoryEntry } from '@/api/types';

/** Summary line for the delete confirmation, e.g. "2 sessions and 3 drinks". */
export function selectionLabel(entries: HistoryEntry[]): string {
  const sessions = entries.filter((e) => e.type === 'session').length;
  const drinks = entries.length - sessions;
  const parts = [];
  if (sessions) parts.push(`${sessions} session${sessions === 1 ? '' : 's'}`);
  if (drinks) parts.push(`${drinks} drink${drinks === 1 ? '' : 's'}`);
  return parts.join(' and ');
}
