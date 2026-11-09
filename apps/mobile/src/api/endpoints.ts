import { api } from './client';
import type {
  Container,
  Dashboard,
  DashboardRange,
  Drink,
  Exercise,
  ExerciseInput,
  GoogleCodeExchangeRequest,
  History,
  NewDrink,
  Page,
  SessionDetail,
  SessionResponse,
  SessionSummary,
  SetEntry,
  Units,
  User,
  Workout,
} from './types';

const seg = encodeURIComponent;

// Auth (unauthenticated routes: no Bearer, no refresh-on-401)
export const exchangeGoogleCode = ({
  code,
  codeVerifier,
  redirectUri,
}: GoogleCodeExchangeRequest) =>
  api.post<SessionResponse>(
    '/auth/google/code',
    { code, codeVerifier, redirectUri },
    { auth: false },
  );

export const logoutSession = (refreshToken: string) =>
  api.post<void>('/auth/logout', { refreshToken }, { auth: false });

export const getMe = () => api.get<User>('/me');
export const updateMe = (body: { units: Units }) => api.patch<User>('/me', body);

// Workouts
export const listWorkouts = () => api.get<Workout[]>('/workouts');
export const getWorkout = (id: string) => api.get<Workout>(`/workouts/${seg(id)}`);
export const createWorkout = (body: { name: string; exercises: ExerciseInput[] }) =>
  api.post<Workout>('/workouts', body);
export const renameWorkout = (id: string, name: string) =>
  api.patch<Workout>(`/workouts/${seg(id)}`, { name });
export const deleteWorkout = (id: string) => api.delete<void>(`/workouts/${seg(id)}`);
export const addExercise = (workoutId: string, body: ExerciseInput) =>
  api.post<Exercise>(`/workouts/${seg(workoutId)}/exercises`, body);
export const updateExercise = (
  workoutId: string,
  exerciseId: string,
  body: Partial<ExerciseInput>,
) => api.patch<Exercise>(`/workouts/${seg(workoutId)}/exercises/${seg(exerciseId)}`, body);
export const deleteExercise = (workoutId: string, exerciseId: string) =>
  api.delete<void>(`/workouts/${seg(workoutId)}/exercises/${seg(exerciseId)}`);

// Sessions
export const startSession = (workoutId: string) =>
  api.post<SessionDetail>('/sessions', { workoutId });
export const getActiveSession = () => api.get<SessionDetail | null>('/sessions/active');
export const getSession = (id: string) => api.get<SessionDetail>(`/sessions/${seg(id)}`);
export const listSessions = (cursor?: string) =>
  api.get<Page<SessionSummary>>('/sessions', { query: { cursor } });
export const endSession = (id: string) => api.post<SessionDetail>(`/sessions/${seg(id)}/end`, {});
export const deleteSession = (id: string) => api.delete<void>(`/sessions/${seg(id)}`);
export const logSet = (sessionId: string, body: { exerciseId: string; amount: number }) =>
  api.post<SetEntry>(`/sessions/${seg(sessionId)}/sets`, body);
export const deleteSet = (id: string) => api.delete<void>(`/sets/${seg(id)}`);

// Containers
export const listContainers = () => api.get<Container[]>('/containers');
export const createContainer = (body: { name: string; volumeMl: number }) =>
  api.post<Container>('/containers', body);
export const updateContainer = (id: string, body: { name?: string; volumeMl?: number }) =>
  api.patch<Container>(`/containers/${seg(id)}`, body);
export const deleteContainer = (id: string) => api.delete<void>(`/containers/${seg(id)}`);

// Drinks
export const logDrink = (body: NewDrink) => api.post<Drink>('/drinks', body);
export const listDrinks = (cursor?: string) =>
  api.get<Page<Drink>>('/drinks', { query: { cursor } });
export const deleteDrink = (id: string) => api.delete<void>(`/drinks/${seg(id)}`);

// Dashboard and history
export const getDashboard = (range: DashboardRange, tz: string) =>
  api.get<Dashboard>('/dashboard', { query: { range, tz } });
export const getHistory = (tz: string, cursor?: string) =>
  api.get<History>('/history', { query: { tz, cursor } });
