import { NextResponse, type NextRequest } from 'next/server';
import { getSession } from '@/lib/session';

async function logout(req: NextRequest) {
  const session = await getSession();
  session.destroy();
  return NextResponse.redirect(new URL('/login', req.url));
}

export async function POST(req: NextRequest) {
  return logout(req);
}

export async function GET(req: NextRequest) {
  return logout(req);
}
