import { redirect } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { verifyPassword } from '@/lib/auth';
import { getSession } from '@/lib/session';

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
    <main style={{ maxWidth: 380, margin: '10vh auto', padding: 24 }}>
      <h1 style={{ marginBottom: 8 }}>Frese Wohnung</h1>
      <p className="muted" style={{ marginBottom: 24 }}>
        Interne Wohnungssuche — Anmeldung erforderlich
      </p>
      {error ? (
        <div
          className="card"
          style={{ padding: 12, marginBottom: 16, borderColor: 'var(--danger)', color: 'var(--danger)' }}
        >
          {error}
        </div>
      ) : null}
      <form action={loginAction} className="card" style={{ padding: 20, display: 'grid', gap: 12 }}>
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
        <button type="submit" className="btn primary">
          Anmelden
        </button>
      </form>
    </main>
  );
}
