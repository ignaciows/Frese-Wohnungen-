/**
 * iron-session backed cookie sessions. iron-session encrypts and signs the
 * session with SESSION_SECRET; nothing besides the user id and role sits in
 * the cookie. All authorisation checks re-read the User from the database.
 */

import { cookies } from 'next/headers';
import { getIronSession, type SessionOptions, type IronSession } from 'iron-session';

export interface SessionData {
  userId?: string;
  role?: 'ADMIN' | 'COLLEAGUE';
  name?: string;
}

function sessionSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error('SESSION_SECRET must be set to at least 32 characters. See .env.example.');
  }
  return secret;
}

export function sessionOptions(): SessionOptions {
  return {
    password: sessionSecret(),
    cookieName: process.env.SESSION_COOKIE_NAME ?? 'frese_wohnung_session',
    cookieOptions: {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.SESSION_SECURE_COOKIE === 'true',
      path: '/',
    },
  };
}

export async function getSession(): Promise<IronSession<SessionData>> {
  const store = await cookies();
  return getIronSession<SessionData>(store, sessionOptions());
}
