import { redirect } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { verifyPassword } from '@/lib/auth';
import { getSession } from '@/lib/session';

export const dynamic = 'force-dynamic';

async function loginAction(formData: FormData) {
  'use server';
  const email = String(formData.get('email') ?? '').trim().toLowerCase();
  const password = String(formData.get('password') ?? '');
  if (!email || !password) return;
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !user.active) redirect('/login?error=Ungültige+Zugangsdaten');
  const ok = await verifyPassword(password, user.passwordHash);
  if (!ok) redirect('/login?error=Ungültige+Zugangsdaten');
  const session = await getSession();
  session.userId = user.id;
  session.role = user.role;
  session.name = user.name;
  await session.save();
  redirect('/');
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  return (
    <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24 }}>
      <div style={{ width: '100%', maxWidth: 380 }}>
        <div className="row" style={{ justifyContent: 'center', marginBottom: 8 }}>
          <span className="brand-dot" style={{ width: 30, height: 30, fontSize: 15 }} aria-hidden>
            F
          </span>
          <h1>Frese Wohnung</h1>
        </div>
        <p className="muted small" style={{ textAlign: 'center', marginBottom: 22 }}>
          Interne Wohnungssuche — Anmeldung erforderlich
        </p>

        {error ? (
          <div className="callout danger" style={{ marginBottom: 14 }}>
            <span className="callout-icon" aria-hidden>
              !
            </span>
            <div>{error}</div>
          </div>
        ) : null}

        <form action={loginAction} className="card card-body stack">
          <div>
            <label htmlFor="email">E-Mail</label>
            <input id="email" name="email" type="email" required autoComplete="username" className="input" />
          </div>
          <div>
            <label htmlFor="password">Passwort</label>
            <input
              id="password"
              name="password"
              type="password"
              required
              autoComplete="current-password"
              className="input"
            />
          </div>
          <button type="submit" className="btn primary block">
            Anmelden
          </button>
        </form>
      </div>
    </main>
  );
}
