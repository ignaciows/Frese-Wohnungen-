'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const TABS = [
  { seg: '', label: 'Übersicht' },
  { seg: 'anschreiben', label: 'Anschreiben' },
  { seg: 'profil', label: 'Suchprofil' },
  { seg: 'quellen', label: 'Quellen' },
  { seg: 'ergebnisse', label: 'Ergebnisse' },
  { seg: 'kontakte', label: 'Kontakte' },
  { seg: 'termine', label: 'Termine' },
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

  return (
    <nav className="tabs" aria-label="Kandidaten-Bereiche">
      {TABS.map((t) => {
        const href = t.seg ? `${base}/${t.seg}` : base;
        const isActive = t.seg
          ? pathname.startsWith(href)
          : pathname === base;
        const count = counts[t.seg || 'overview'];
        return (
          <Link key={t.seg} href={href} className="tab" aria-current={isActive ? 'page' : undefined}>
            {t.label}
            {typeof count === 'number' && count > 0 ? <span className="tab-count">{count}</span> : null}
          </Link>
        );
      })}
    </nav>
  );
}
