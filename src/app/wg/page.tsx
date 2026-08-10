import Link from 'next/link';
import { redirect } from 'next/navigation';
import { inboxCounts } from '@/server/followUps';
import { currentUser } from '@/lib/auth';
import { loadOpenSuggestions } from '@/server/sharing';
import { getSharingSettings } from '@/server/settings';
import { refreshSharingAction, decideSharingAction } from '@/app/actions';
import { AppBar, Empty, Callout } from '@/app/_components/Shell';
import { formatDate } from '@/lib/labels';

export const dynamic = 'force-dynamic';

export default async function WgPage() {
  const user = await currentUser();
  if (!user) redirect('/login');
  const pending = await inboxCounts();

  const [suggestions, settings] = await Promise.all([loadOpenSuggestions(), getSharingSettings()]);

  return (
    <>
      <AppBar user={user} active="wg" pending={pending.dueTasks + pending.unreadReplies} />
      <main className="container page" style={{ maxWidth: 980 }}>
        <div className="page-head">
          <div className="page-title">
            <h1>WG-Vorschläge</h1>
            <span className="sub">
              Kandidaten, die zeitgleich in dieselbe Region ziehen und beide offen für eine WG sind.
            </span>
          </div>
          <form action={refreshSharingAction}>
            <button type="submit" className="btn">
              Vorschläge neu berechnen
            </button>
          </form>
        </div>

        {!settings.enabled ? (
          <Callout tone="warning">
            WG-Matching ist in den <Link href="/einstellungen">Einstellungen</Link> deaktiviert.
          </Callout>
        ) : null}

        <Callout tone="info">
          <strong>Nur ein Vorschlag — nichts passiert automatisch.</strong> Es werden ausschließlich
          Kandidaten berücksichtigt, die ausdrücklich als „offen für WG“ markiert sind. Ob und wie beide
          angesprochen werden, entscheidet immer ein Mensch. Erst wenn beide zustimmen und sich kennengelernt
          haben, wird gemeinsam gesucht.
        </Callout>

        <div className="stack" style={{ marginTop: 20 }}>
          {suggestions.length === 0 ? (
            <div className="card">
              <Empty icon="⇄" title="Keine Vorschläge">
                Es gibt gerade kein Paar, das zeitlich und regional zusammenpasst. Markiere Kandidaten im
                jeweiligen Suchprofil als „offen für WG“, damit sie berücksichtigt werden.
              </Empty>
            </div>
          ) : (
            suggestions.map((s) => {
              const reasons = Array.isArray(s.reasons) ? (s.reasons as string[]) : [];
              return (
                <div key={s.id} className="card card-pad">
                  <div className="row-between" style={{ alignItems: 'flex-start' }}>
                    <div className="grow stack-sm">
                      <div className="row-wrap">
                        <span className="badge brand">{Math.round(s.score)} Punkte</span>
                        <h3>
                          <Link href={`/kandidat/${s.caseA.id}`}>{s.caseA.displayName}</Link>
                          <span className="muted"> ⇄ </span>
                          <Link href={`/kandidat/${s.caseB.id}`}>{s.caseB.displayName}</Link>
                        </h3>
                      </div>
                      <div className="row-wrap small muted">
                        <span>{s.caseA.reference}</span>
                        <span aria-hidden>·</span>
                        <span>{s.caseB.reference}</span>
                        {s.caseA.searchProfile?.moveInDate ? (
                          <>
                            <span aria-hidden>·</span>
                            <span>Einzug ab {formatDate(s.caseA.searchProfile.moveInDate)}</span>
                          </>
                        ) : null}
                      </div>
                      <div className="stack-sm" style={{ marginTop: 4 }}>
                        {reasons.map((r, i) => (
                          <div key={i} className="reason plus">
                            <span className="mark">+</span>
                            <span>{r}</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="stack-sm" style={{ flexShrink: 0, minWidth: 190 }}>
                      <form action={decideSharingAction}>
                        <input type="hidden" name="suggestionId" value={s.id} />
                        <input type="hidden" name="status" value="ACCEPTED" />
                        <button type="submit" className="btn primary block">
                          Beiden vorschlagen
                        </button>
                      </form>
                      <form action={decideSharingAction} className="stack-sm">
                        <input type="hidden" name="suggestionId" value={s.id} />
                        <input type="hidden" name="status" value="DISMISSED" />
                        <input
                          name="dismissReason"
                          className="input"
                          placeholder="Grund (optional)"
                        />
                        <button type="submit" className="btn block">
                          Verwerfen
                        </button>
                      </form>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </main>
    </>
  );
}
