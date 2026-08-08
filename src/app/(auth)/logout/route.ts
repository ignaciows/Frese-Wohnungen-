import { NextResponse, type NextRequest } from 'next/server';
import { getSession } from '@/lib/session';

/**
 * POST only, deliberately.
 *
 * A GET logout is destructive on a safe method: Next.js prefetches <Link>
 * targets in the viewport, so a "Sign out" link would silently destroy the
 * session while the user was just looking at the page. The UI submits a form.
 */
export async function POST(req: NextRequest) {
  const session = await getSession();
  session.destroy();
  return NextResponse.redirect(new URL('/login', req.url), { status: 303 });
}
