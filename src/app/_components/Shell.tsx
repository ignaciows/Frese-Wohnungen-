import Link from 'next/link';

export function AppBar({
  user,
  active,
}: {
  user: { name: string; role: string };
  active?: 'kandidaten' | 'quellen' | 'wg' | 'einstellungen';
}) {
  return (
    <header className="appbar">
      <div className="container-wide appbar-inner">
        <Link href="/" className="brandmark">
          <span className="brand-dot" aria-hidden>
            F
          </span>
          Frese Wohnung
        </Link>
        <nav className="appbar-nav" aria-label="Hauptnavigation">
          <Link href="/" aria-current={active === 'kandidaten' ? 'page' : undefined}>
            Kandidaten
          </Link>
          <Link href="/wg" aria-current={active === 'wg' ? 'page' : undefined}>
            WG-Vorschläge
          </Link>
          <Link href="/quellen" aria-current={active === 'quellen' ? 'page' : undefined}>
            Quellen
          </Link>
          <Link href="/einstellungen" aria-current={active === 'einstellungen' ? 'page' : undefined}>
            Einstellungen
          </Link>
        </nav>
        <div className="grow" />
        <span className="small muted nowrap">
          {user.name}
          {user.role === 'ADMIN' ? ' · Admin' : ''}
        </span>
        {/* POST, so route prefetching can never sign the user out. */}
        <form action="/logout" method="post">
          <button type="submit" className="btn sm ghost">
            Abmelden
          </button>
        </form>
      </div>
    </header>
  );
}

export function Crumbs({ items }: { items: Array<{ label: string; href?: string }> }) {
  return (
    <nav className="crumbs" aria-label="Brotkrumen">
      {items.map((item, i) => (
        <span key={`${item.label}-${i}`} className="row" style={{ gap: 7 }}>
          {i > 0 ? (
            <span className="sep" aria-hidden>
              /
            </span>
          ) : null}
          {item.href ? <Link href={item.href}>{item.label}</Link> : <span className="current">{item.label}</span>}
        </span>
      ))}
    </nav>
  );
}

export function Stat({
  value,
  label,
  accent,
}: {
  value: React.ReactNode;
  label: string;
  accent?: boolean;
}) {
  return (
    <div className={accent ? 'stat accent' : 'stat'}>
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
    </div>
  );
}

export function Empty({
  icon = '□',
  title,
  children,
  action,
}: {
  icon?: string;
  title: string;
  children?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty-icon" aria-hidden>
        {icon}
      </div>
      <h3>{title}</h3>
      {children ? <p>{children}</p> : null}
      {action ? <div style={{ marginTop: 6 }}>{action}</div> : null}
    </div>
  );
}

export function Callout({
  tone = 'info',
  icon,
  children,
}: {
  tone?: 'info' | 'warning' | 'danger' | 'success';
  icon?: string;
  children: React.ReactNode;
}) {
  const fallback = { info: 'i', warning: '!', danger: '!', success: '✓' }[tone];
  return (
    <div className={`callout ${tone}`}>
      <span className="callout-icon" aria-hidden>
        {icon ?? fallback}
      </span>
      <div>{children}</div>
    </div>
  );
}
