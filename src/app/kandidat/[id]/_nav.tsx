'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

/**
 * Four tabs, not nine.
 *
 * The nine were all real screens, but only four of them are ever the job:
 * where the case stands, which flats to write to, what has been sent, and what
 * is in the diary. The other five are things you set up once — the message, the
 * search profile, the master data — or read afterwards, and at equal weight
 * they made the four that matter something you had to look for. They keep their
 * URLs and sit in a second, quieter row.
 */
const MAIN = [
  { seg: '', label: 'Übersicht', countKey: 'overview' },
  { seg: 'ergebnisse', label: 'Ergebnisse', countKey: 'ergebnisse' },
  { seg: 'kontakte', label: 'Anfragen', countKey: 'kontakte' },
  { seg: 'termine', label: 'Termine', countKey: 'termine' },
] as const;

const SETUP = [
  { seg: 'anschreiben', label: 'Anschreiben' },
  { seg: 'profil', label: 'Suchprofil' },
  { seg: 'quellen', label: 'Quellen' },
  { seg: 'verlauf', label: 'Verlauf' },
  { seg: 'stammdaten', label: 'Stammdaten' },
] as const;

export function CandidateNav({
  candidateId,
  counts,
}: {
  candidateId: string;
  counts: Partial<Record<string, number>>;
}) {
  const pathname = usePathname();
  const base = `/kandidat/${candidateId}`;
  const isOn = (seg: string) => (seg ? pathname.startsWith(`${base}/${seg}`) : pathname === base);

  return (
    <div className="stack-sm">
      <nav className="tabs" aria-label="Kandidaten-Bereiche">
        {MAIN.map((t) => {
          const count = counts[t.countKey];
          return (
            <Link
              key={t.seg}
              href={t.seg ? `${base}/${t.seg}` : base}
              className="tab"
              aria-current={isOn(t.seg) ? 'page' : undefined}
            >
              {t.label}
              {typeof count === 'number' && count > 0 ? <span className="tab-count">{count}</span> : null}
            </Link>
          );
        })}
      </nav>
      <nav className="subnav" aria-label="Einstellungen zu diesem Fall">
        <span className="subnav-label">Zum Fall:</span>
        {SETUP.map((t) => (
          <Link
            key={t.seg}
            href={`${base}/${t.seg}`}
            className="subnav-link"
            aria-current={isOn(t.seg) ? 'page' : undefined}
          >
            {t.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
