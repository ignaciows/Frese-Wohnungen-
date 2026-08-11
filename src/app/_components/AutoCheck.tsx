'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  maybeRunLivenessSweepAction,
  maybeRunDiscoverySweepAction,
  forceDiscoverySweepAction,
  maybeRescoreAction,
} from '@/app/actions';

/**
 * Brings the list up to date when somebody opens it.
 *
 * Two passes, in this order and for this reason: the link check runs first and
 * is fast, so dead ads disappear immediately; the search for new ones runs
 * second and takes longer, because a stale list is the complaint and a
 * slightly late arrival is not.
 *
 * Both server actions throttle themselves, so mounting this on every page load
 * costs nothing when a sweep has just run. Neither can disturb the page: a
 * failure is swallowed and the list simply stays as it was.
 */
export function AutoCheck({ candidateCaseId }: { candidateCaseId?: string } = {}) {
  const router = useRouter();
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Always known, always shown. The complaint was never that the search was
  // slow — it was that there was no way to tell whether it had run at all.
  const [lastRunAt, setLastRunAt] = useState<string | null>(null);
  const [enabledSources, setEnabledSources] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const parts: string[] = [];
      let changed = false;

      // Before anything else: if the ranking rules changed since these matches
      // were scored, the list on screen is wrong in a way no amount of link
      // checking would fix.
      if (candidateCaseId) {
        try {
          const r = await maybeRescoreAction(candidateCaseId);
          if (cancelled) return;
          if (r.rescored) {
            parts.push('Bewertungen nach geänderten Regeln neu berechnet');
            changed = true;
          }
        } catch {
          // Never block the page on a re-score.
        }
      }

      try {
        // Scoped to this candidate so the ads actually on screen are the ones
        // re-read, rather than whatever was oldest across the database.
        const liveness = await maybeRunLivenessSweepAction(candidateCaseId);
        if (cancelled) return;
        if (liveness.ran && liveness.expired > 0) {
          parts.push(`${liveness.expired} nicht mehr verfügbare Anzeige(n) ausgeblendet`);
          changed = true;
        } else if (liveness.ran && liveness.checked > 0) {
          changed = true;
        }
        if (liveness.ran && liveness.limbo > 0) {
          parts.push(`${liveness.limbo} unklar — im Reiter „Zu prüfen"`);
        }
      } catch {
        // A failed background check must never disturb the page.
      }

      try {
        setBusy(true);
        const discovery = await maybeRunDiscoverySweepAction();
        if (cancelled) return;
        setLastRunAt(discovery.lastRunAt ? new Date(discovery.lastRunAt).toISOString() : null);
        setEnabledSources(discovery.enabledSources);
        if (discovery.ran) {
          if (discovery.created > 0) parts.push(`${discovery.created} neue Anzeige(n) gefunden`);
          if (discovery.retired > 0) parts.push(`${discovery.retired} verschwundene Anzeige(n) entfernt`);
          if (discovery.created > 0 || discovery.retired > 0) changed = true;
          // Say so when a portal turned us away, rather than letting an empty
          // list imply the market is empty.
          if (discovery.sourcesBlocked > 0) {
            parts.push(`${discovery.sourcesBlocked} Quelle(n) blockieren automatische Abrufe`);
          }
        }
      } catch {
        // Same: discovery is best-effort.
      } finally {
        if (!cancelled) setBusy(false);
      }

      if (cancelled) return;
      if (parts.length > 0) setNote(parts.join(' · ') + '.');
      if (changed) router.refresh();
    })();

    return () => {
      cancelled = true;
    };
  }, [router, candidateCaseId]);

  async function searchNow() {
    setBusy(true);
    setNote(null);
    try {
      const s = await forceDiscoverySweepAction();
      setNote(
        s.created > 0 || s.retired > 0
          ? `${s.created} neu, ${s.retired} entfernt.`
          : 'Gesucht — nichts Neues.',
      );
      setLastRunAt(new Date().toISOString());
      router.refresh();
    } catch {
      setNote('Suche fehlgeschlagen.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={`freshness ${enabledSources === 0 ? 'warn' : ''}`}>
      <span className="freshness-dot" aria-hidden />
      <span className="freshness-text">
        {busy
          ? 'Sucht gerade nach neuen Anzeigen …'
          : enabledSources === 0
            ? 'Keine Quelle eingeschaltet — es wird nicht gesucht. Unter Einstellungen → Quellen einschalten.'
            : lastRunAt
              ? `Zuletzt gesucht: ${whenLabel(lastRunAt)}`
              : 'Noch nicht gesucht'}
        {note ? <strong className="freshness-note"> · {note}</strong> : null}
      </span>
      <button type="button" className="btn sm" onClick={() => void searchNow()} disabled={busy}>
        {busy ? 'Sucht …' : 'Jetzt suchen'}
      </button>
    </div>
  );
}

/**
 * "heute 21:40" rather than a date. The question this line answers is "is what
 * I am looking at from today?", and a bare timestamp makes the reader do the
 * subtraction — which is exactly the step that went wrong when ads dated five
 * days ago sat under a screen that looked freshly loaded.
 */
function whenLabel(iso: string): string {
  const then = new Date(iso);
  const time = then.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
  const days = Math.floor(
    (startOfDay(new Date()).getTime() - startOfDay(then).getTime()) / 86_400_000,
  );
  if (days === 0) return `heute ${time} Uhr`;
  if (days === 1) return `gestern ${time} Uhr`;
  return `vor ${days} Tagen (${then.toLocaleDateString('de-DE')})`;
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
