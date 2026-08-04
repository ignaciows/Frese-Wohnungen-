import Link from 'next/link';
import { CasePicker } from './CasePicker';

interface Props {
  user: { name: string; role: string };
  cases: Array<{ id: string; reference: string; displayName: string; status: string }>;
  selectedCaseId: string | null;
}

export function TopBar({ user, cases, selectedCaseId }: Props) {
  return (
    <header
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '10px 16px',
        borderBottom: '1px solid var(--border)',
        background: 'var(--card)',
      }}
    >
      <div style={{ fontWeight: 700 }}>Frese Wohnung</div>
      <div className="muted" style={{ fontSize: 12 }}>
        Interne Wohnungssuche
      </div>
      <div style={{ marginLeft: 24, display: 'flex', gap: 8, alignItems: 'center' }}>
        <span style={{ margin: 0, color: 'var(--muted)', fontSize: 12 }}>Kandidat:</span>
        {cases.length > 0 ? <CasePicker cases={cases} selectedCaseId={selectedCaseId} /> : null}
      </div>
      <Link href="/candidates/new" className="btn small" style={{ marginLeft: 8 }}>
        + Neuer Kandidat
      </Link>
      <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 12 }}>
        <Link href="/sources" className="btn small">
          Quellen
        </Link>
        <span className="muted" style={{ fontSize: 12 }}>
          {user.name} · {user.role === 'ADMIN' ? 'Admin' : 'Kollege'}
        </span>
        <form action="/logout" method="post">
          <button type="submit" className="btn small">
            Abmelden
          </button>
        </form>
      </div>
    </header>
  );
}
