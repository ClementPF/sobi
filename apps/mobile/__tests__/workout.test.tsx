import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import {
  deleteSession,
  deleteSet,
  endSession,
  getActiveSession,
  listWorkouts,
  logSet,
  startSession,
} from '@/api/endpoints';
import type { Metric, SessionDetail, SetEntry, Workout } from '@/api/types';
import { useUnits } from '@/auth/session';
import { WorkoutScreen } from '@/features/workout/workout-screen';
import { queryKeys } from '@/lib/queries';

jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('@/auth/session', () => ({ useUnits: jest.fn(() => 'metric') }));
jest.mock('@/api/endpoints', () => ({
  deleteSession: jest.fn(),
  deleteSet: jest.fn(),
  duplicateWorkout: jest.fn(),
  endSession: jest.fn(),
  getActiveSession: jest.fn(),
  listWorkouts: jest.fn(),
  logSet: jest.fn(),
  startSession: jest.fn(),
  updateSessionNote: jest.fn(),
}));

function makeSession(
  lastAmount: number | null = null,
  metric: Metric = 'count',
  weightKg: number | null = null,
): SessionDetail {
  return {
    id: 'session',
    workout: { id: 'workout', name: 'Push day' },
    startedAt: '2026-11-08T10:00:00Z',
    endedAt: null,
    setCount: 0,
    earnedDrinks: 0,
    note: null,
    exercises: [
      {
        id: 'exercise',
        workoutId: 'workout',
        name: 'Push-ups',
        metric,
        earnDrinks: 1,
        earnPer: 100,
        sortOrder: 0,
        archived: false,
        sets: [],
        previousSet: lastAmount === null ? null : { amount: lastAmount, weightKg },
      },
    ],
  };
}

let session: SessionDetail | null;
let sequence: number;
let client: QueryClient;

function appendSet(amount: number, weightKg: number | null = null): SetEntry {
  const exercise = session!.exercises[0]!;
  const set: SetEntry = {
    id: `set-${++sequence}`,
    sessionId: session!.id,
    exerciseId: exercise.id,
    amount,
    weightKg,
    earnedDrinks: amount / 100,
    createdAt: '2026-11-08T10:01:00Z',
  };
  session = {
    ...session!,
    setCount: session!.setCount + 1,
    earnedDrinks: session!.earnedDrinks + set.earnedDrinks,
    exercises: [{ ...exercise, sets: [...exercise.sets, set] }],
  };
  return set;
}

async function renderWorkout() {
  await render(
    <QueryClientProvider client={client}>
      <WorkoutScreen />
    </QueryClientProvider>,
  );
  await screen.findByRole('button', { name: 'Cancel workout' });
  return client;
}

beforeEach(() => {
  jest.resetAllMocks();
  client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { retry: false, gcTime: Infinity },
    },
  });
  sequence = 0;
  session = makeSession();
  jest.mocked(useUnits).mockReturnValue('metric');
  jest.mocked(getActiveSession).mockImplementation(async () => session);
  jest.mocked(listWorkouts).mockResolvedValue([]);
  jest.mocked(deleteSession).mockImplementation(async () => {
    session = null;
  });
  jest
    .mocked(logSet)
    .mockImplementation(async (_id, { amount, weightKg }) => appendSet(amount, weightKg));
  jest.mocked(endSession).mockImplementation(async () => {
    const ended = { ...session!, endedAt: '2026-11-08T11:00:00Z' };
    session = null;
    return ended;
  });
});

afterEach(() => client.clear());

describe('workout cancellation', () => {
  it.each(['Cancel workout', 'End session'])(
    'deletes an empty session via %s without confirmation',
    async (title) => {
      const client = await renderWorkout();
      client.setQueryData(queryKeys.history, { days: [] });
      client.setQueryData(queryKeys.dashboard('7d'), { balance: 0 });

      await fireEvent.press(screen.getByRole('button', { name: title }));

      await screen.findByText('Pick a workout');
      expect(deleteSession).toHaveBeenCalledWith('session');
      expect(endSession).not.toHaveBeenCalled();
      expect(screen.queryByTestId('confirm-dialog')).toBeNull();
      expect(client.getQueryData(queryKeys.activeSession)).toBeNull();
      expect(client.getQueryState(queryKeys.history)?.isInvalidated).toBe(true);
      expect(client.getQueryState(queryKeys.dashboard('7d'))?.isInvalidated).toBe(true);
    },
  );

  it('keeps a workout with sets until cancellation is confirmed', async () => {
    appendSet(25);
    await renderWorkout();
    await fireEvent.press(screen.getByRole('button', { name: 'Cancel workout' }));
    expect(screen.getByText('Cancel workout?')).toBeTruthy();
    expect(deleteSession).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByTestId('confirm-dialog')).toBeNull();
    expect(deleteSession).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByRole('button', { name: 'Cancel workout' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Discard workout' }));
    await screen.findByText('Pick a workout');
    expect(deleteSession).toHaveBeenCalledTimes(1);
    expect(endSession).not.toHaveBeenCalled();
  });

  it('confirms cancellation even when sets earn no drinks', async () => {
    appendSet(25);
    session = { ...session!, earnedDrinks: 0 };
    await renderWorkout();
    await fireEvent.press(screen.getByRole('button', { name: 'Cancel workout' }));
    expect(screen.getByText('Cancel workout?')).toBeTruthy();
    expect(deleteSession).not.toHaveBeenCalled();
  });

  it.each([false, true])(
    'keeps the session and shows an error when deletion fails (has sets: %s)',
    async (hasSets) => {
      if (hasSets) appendSet(25);
      jest.mocked(deleteSession).mockRejectedValueOnce(new Error('Could not cancel workout.'));
      await renderWorkout();
      await fireEvent.press(screen.getByRole('button', { name: 'Cancel workout' }));
      if (hasSets) {
        await fireEvent.press(screen.getByRole('button', { name: 'Discard workout' }));
      }
      await screen.findByText('Could not cancel workout.');
      expect(screen.queryByText('Pick a workout')).toBeNull();
      const retry = screen.getByRole('button', {
        name: hasSets ? 'Discard workout' : 'Cancel workout',
      });
      expect(retry).toBeEnabled();

      await fireEvent.press(retry);
      await screen.findByText('Pick a workout');
    },
  );

  it('prevents duplicate cancellation and dismissing the confirmation while deleting', async () => {
    appendSet(25);
    let finish!: () => void;
    jest.mocked(deleteSession).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = () => {
            session = null;
            resolve();
          };
        }),
    );
    await renderWorkout();
    await fireEvent.press(screen.getByRole('button', { name: 'Cancel workout' }));
    const discard = screen.getByRole('button', { name: 'Discard workout' });
    await fireEvent.press(discard);
    await waitFor(() => expect(discard).toBeDisabled());
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    await fireEvent.press(discard);
    expect(deleteSession).toHaveBeenCalledTimes(1);
    await act(async () => finish());
    await screen.findByText('Pick a workout');
  });

  it('still ends a nonempty session without deleting it', async () => {
    appendSet(25);
    await renderWorkout();
    await fireEvent.press(screen.getByRole('button', { name: 'End session' }));
    expect(screen.getByText('End session?')).toBeTruthy();
    expect(endSession).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByRole('button', { name: 'End' }));
    await screen.findByText('Pick a workout');
    expect(endSession).toHaveBeenCalledWith('session');
    expect(deleteSession).not.toHaveBeenCalled();
  });
});

describe('previous-set shortcut', () => {
  it('keeps + Set available without inventing a previous amount', async () => {
    await renderWorkout();
    expect(screen.getByRole('button', { name: 'Add set of Push-ups' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Repeat / })).toBeNull();
  });

  it('offers the previous session amount immediately after starting a workout', async () => {
    const started = makeSession(25);
    const workout: Workout = {
      id: 'workout',
      name: 'Push day',
      createdAt: started.startedAt,
      exercises: started.exercises,
    };
    session = null;
    jest.mocked(listWorkouts).mockResolvedValue([workout]);
    jest.mocked(startSession).mockImplementation(async () => {
      session = started;
      return started;
    });
    await render(
      <QueryClientProvider client={client}>
        <WorkoutScreen />
      </QueryClientProvider>,
    );
    await fireEvent.press(await screen.findByRole('button', { name: 'Start' }));
    await screen.findByRole('button', { name: 'Repeat 25 of Push-ups' });
    await fireEvent.press(screen.getByRole('button', { name: 'Repeat 25 of Push-ups' }));
    await waitFor(() =>
      expect(logSet).toHaveBeenCalledWith('session', {
        exerciseId: 'exercise',
        amount: 25,
        weightKg: null,
      }),
    );
    expect(screen.queryByTestId('set-sheet')).toBeNull();
    await screen.findByRole('button', { name: 'Remove set 25' });
  });

  it('updates the shortcut after a custom set and keeps it to the left of + Set', async () => {
    session = makeSession(25);
    await renderWorkout();
    const actions = screen.getAllByRole('button');
    expect(
      actions.findIndex((button) => button.props.accessibilityLabel === 'Repeat 25 of Push-ups'),
    ).toBeLessThan(
      actions.findIndex((button) => button.props.accessibilityLabel === 'Add set of Push-ups'),
    );
    await fireEvent.press(screen.getByRole('button', { name: 'Add set of Push-ups' }));
    expect(screen.getByText('25 → +0.25 drinks')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('reps 15'));
    await fireEvent.press(screen.getByRole('button', { name: 'Log set' }));
    await screen.findByRole('button', { name: 'Repeat 15 of Push-ups' });
    await fireEvent.press(screen.getByRole('button', { name: 'Repeat 15 of Push-ups' }));
    await waitFor(() =>
      expect(logSet).toHaveBeenLastCalledWith('session', {
        exerciseId: 'exercise',
        amount: 15,
        weightKg: null,
      }),
    );
    await waitFor(() =>
      expect(screen.getAllByRole('button', { name: 'Remove set 15' })).toHaveLength(2),
    );
  });

  it.each([
    ['seconds', 'metric', 95, '1:35'],
    ['meters', 'metric', 2350, '2.35 km'],
    ['meters', 'imperial', 1609, '1 mi'],
  ] as const)(
    'repeats exact %s amounts in %s units without picker rounding',
    async (metric, units, amount, label) => {
      session = makeSession(amount, metric);
      jest.mocked(useUnits).mockReturnValue(units);
      await renderWorkout();
      await fireEvent.press(screen.getByRole('button', { name: `Repeat ${label} of Push-ups` }));
      await waitFor(() =>
        expect(logSet).toHaveBeenCalledWith('session', {
          exerciseId: 'exercise',
          amount,
          weightKg: null,
        }),
      );
      await screen.findByRole('button', { name: `Remove set ${label}` });
    },
  );

  it.each([
    ['metric', 22.5, '22.5 kg'],
    ['imperial', 20.412, '45 lb'],
  ] as const)('preserves the previous set weight in %s units', async (units, weightKg, label) => {
    session = makeSession(25, 'count', weightKg);
    jest.mocked(useUnits).mockReturnValue(units);
    await renderWorkout();
    await fireEvent.press(screen.getByRole('button', { name: `Repeat 25 × ${label} of Push-ups` }));
    await screen.findByRole('button', { name: `Remove set 25 × ${label}` });
    expect(logSet).toHaveBeenCalledWith('session', {
      exerciseId: 'exercise',
      amount: 25,
      weightKg,
    });
  });

  it('uses the latest current set weight rather than the historical weight', async () => {
    session = makeSession(25, 'count', 22.5);
    appendSet(15, 30);
    await renderWorkout();
    await fireEvent.press(screen.getByRole('button', { name: 'Repeat 15 × 30 kg of Push-ups' }));
    await waitFor(() =>
      expect(logSet).toHaveBeenCalledWith('session', {
        exerciseId: 'exercise',
        amount: 15,
        weightKg: 30,
      }),
    );
    await waitFor(() =>
      expect(screen.getAllByRole('button', { name: 'Remove set 15 × 30 kg' })).toHaveLength(2),
    );
  });

  it('disables repeat, add, and cancel while a set is being saved', async () => {
    session = makeSession(25);
    let finish!: (set: SetEntry) => void;
    jest.mocked(logSet).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    await renderWorkout();
    const repeat = screen.getByRole('button', { name: 'Repeat 25 of Push-ups' });
    await fireEvent.press(repeat);
    await waitFor(() => expect(repeat).toBeDisabled());
    expect(screen.getByRole('button', { name: 'Add set of Push-ups' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel workout' })).toBeDisabled();
    await fireEvent.press(repeat);
    expect(logSet).toHaveBeenCalledTimes(1);
    await act(async () => finish(appendSet(25)));
    await waitFor(() => expect(repeat).toBeEnabled());
  });

  it('shows a failed repeat without adding a set and allows retrying', async () => {
    session = makeSession(25);
    jest.mocked(logSet).mockRejectedValueOnce(new Error('Could not log set.'));
    await renderWorkout();
    await fireEvent.press(screen.getByRole('button', { name: 'Repeat 25 of Push-ups' }));
    await screen.findByText('Could not log set.');
    expect(screen.queryByRole('button', { name: 'Remove set 25' })).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: 'Repeat 25 of Push-ups' }));
    await screen.findByRole('button', { name: 'Remove set 25' });
  });

  it('falls back to the historical shortcut after removing the last current set', async () => {
    session = makeSession(25);
    appendSet(15);
    jest.mocked(deleteSet).mockImplementation(async () => {
      session = makeSession(25);
    });
    await renderWorkout();
    await fireEvent.press(screen.getByRole('button', { name: 'Remove set 15' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Remove' }));
    await screen.findByRole('button', { name: 'Repeat 25 of Push-ups' });
    await fireEvent.press(screen.getByRole('button', { name: 'Cancel workout' }));
    await screen.findByText('Pick a workout');
    expect(screen.queryByTestId('confirm-dialog')).toBeNull();
  });

  it('does not allow adding or repeating sets for archived exercises', async () => {
    appendSet(25);
    session!.exercises[0]!.archived = true;
    await renderWorkout();
    expect(screen.getByRole('button', { name: 'Remove set 25' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Add set of Push-ups' })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Repeat / })).toBeNull();
  });
});
