import { useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';

export const queryKeys = {
  dashboard: (range: string) => ['dashboard', range] as const,
  history: ['history'] as const,
  workouts: ['workouts'] as const,
  workout: (id: string) => ['workouts', id] as const,
  activeSession: ['sessions', 'active'] as const,
  session: (id: string) => ['sessions', id] as const,
  containers: ['containers'] as const,
};

/** Balance, history and sessions all change when a set or a drink is logged or deleted. */
export function useInvalidateTotals() {
  const client = useQueryClient();
  return useCallback(
    () =>
      Promise.all([
        client.invalidateQueries({ queryKey: ['dashboard'] }),
        client.invalidateQueries({ queryKey: queryKeys.history }),
        client.invalidateQueries({ queryKey: ['sessions'] }),
      ]),
    [client],
  );
}
