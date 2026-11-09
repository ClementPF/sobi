// Mirrors the backend's zod DTOs (apps/backend/src/lib/serializers.ts and route schemas).

export interface ErrorEnvelope {
  error: { code: string; message: string };
}

export type Units = 'metric' | 'imperial';

export interface User {
  id: string;
  email: string | null;
  name: string | null;
  pictureUrl: string | null;
  /** Display preference only; the API always takes and returns ml and meters. */
  units: Units;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

export interface SessionResponse extends TokenPair {
  user: User;
}

export interface GoogleCodeExchangeRequest {
  code: string;
  codeVerifier: string;
  redirectUri: string;
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export type Metric = 'count' | 'seconds' | 'meters';

export interface Exercise {
  id: string;
  workoutId: string;
  name: string;
  metric: Metric;
  /** Standard drinks earned per `earnPer` units. */
  earnDrinks: number;
  earnPer: number;
  sortOrder: number;
  archived: boolean;
}

export interface ExerciseInput {
  name: string;
  metric: Metric;
  earnDrinks: number;
  earnPer: number;
}

export interface Workout {
  id: string;
  name: string;
  createdAt: string;
  exercises: Exercise[];
}

export interface SetEntry {
  id: string;
  sessionId: string;
  exerciseId: string;
  amount: number;
  earnedDrinks: number;
  createdAt: string;
}

export interface SessionSummary {
  id: string;
  workout: { id: string; name: string };
  startedAt: string;
  endedAt: string | null;
  setCount: number;
  earnedDrinks: number;
}

export interface SessionDetail extends SessionSummary {
  exercises: (Exercise & { sets: SetEntry[] })[];
}

export interface Container {
  id: string;
  name: string;
  volumeMl: number;
}

export interface Drink {
  id: string;
  consumedAt: string;
  abv: number;
  volumeMl: number;
  containerId: string | null;
  containerName: string | null;
  alcoholG: number;
  stdDrinks: number;
}

export interface NewDrink {
  abv: number;
  volumeMl?: number;
  containerId?: string;
  consumedAt?: string;
}

export type DashboardRange = '7d' | '30d' | '90d' | 'all';

export interface Dashboard {
  range: DashboardRange;
  from: string;
  to: string;
  /** All-time earned minus drunk; negative is debt. */
  balance: number;
  totalEarned: number;
  totalDrunk: number;
  rangeEarned: number;
  rangeDrunk: number;
  series: { date: string; earned: number; drunk: number; balance: number }[];
  weekly: { weekStart: string; earned: number; drunk: number }[];
  stats: {
    avgDrunkPerWeek: number;
    avgEarnedPerWeek: number;
    sessionsPerWeek: number;
    dryStreakDays: number;
    /** ISO weekday, 1 = Monday … 7 = Sunday. */
    topDrinkingWeekday: number | null;
  };
}

export interface HistorySessionEntry {
  type: 'session';
  id: string;
  at: string;
  endedAt: string | null;
  workoutName: string;
  setCount: number;
  earnedDrinks: number;
}

export interface HistoryDrinkEntry {
  type: 'drink';
  id: string;
  at: string;
  abv: number;
  volumeMl: number;
  containerName: string | null;
  alcoholG: number;
  stdDrinks: number;
}

export type HistoryEntry = HistorySessionEntry | HistoryDrinkEntry;

export interface HistoryDay {
  date: string;
  earned: number;
  drunk: number;
  entries: HistoryEntry[];
}

export interface History {
  days: HistoryDay[];
  nextCursor: string | null;
}
