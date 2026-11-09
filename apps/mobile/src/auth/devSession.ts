import { api } from '@/api/client';
import { APP_ENV, DEV_AUTH } from '@/api/config';
import type { SessionResponse } from '@/api/types';

/** Any email works: the backend creates the dev user on first sign-in. */
export const DEV_EMAILS = ['dev@sobi.local', 'dev2@sobi.local'];

export function isDevSessionEnabled(): boolean {
  return APP_ENV !== 'production' && DEV_AUTH.length > 0;
}

export async function requestDevSession(email: string): Promise<SessionResponse> {
  if (!isDevSessionEnabled()) {
    throw new Error('Dev sessions are disabled in this build.');
  }
  return api.post<SessionResponse>(
    '/auth/dev-token',
    { email },
    { auth: false, headers: { 'x-dev-auth': DEV_AUTH } },
  );
}
