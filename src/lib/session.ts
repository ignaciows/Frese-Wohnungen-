/**
 * iron-session backed cookie sessions. iron-session encrypts and signs the
 * session with SESSION_SECRET; nothing besides the user id and role sits in
 * the cookie. All authorisation checks re-read the User from the database.
 */

import { cookies } from 'next/headers';
import { getIronSession, unsealData, type SessionOptions, type IronSession } from 'iron-session';

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

/**
 * Writable session. Only safe inside Server Actions and Route Handlers, where
 * Next.js permits setting cookies. Use `readSession()` everywhere else.
 */
export async function getSession(): Promise<IronSession<SessionData>> {
  const store = await cookies();
  return getIronSession<SessionData>(store, sessionOptions());
}

/**
 * Read-only session for Server Components / layouts.
 *
 * `getIronSession` re-writes the cookie to refresh it. Server Components cannot
 * set cookies, and doing it anyway drops the cookie from the response — which
 * logs the user out at random when a layout and a page both read the session.
 * Unsealing directly avoids any write.
 */
export async function readSession(): Promise<SessionData> {
  const store = await cookies();
  const raw = store.get(sessionOptions().cookieName)?.value;
  if (!raw) return {};
  try {
    return await unsealData<SessionData>(raw, { password: sessionSecret(), ttl: 0 });
  } catch {
    // Tampered, truncated, or sealed with an older SESSION_SECRET.
    return {};
  }
}
