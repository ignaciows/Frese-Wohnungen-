'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { formatEuroCents } from '@/lib/money';
import {
  maybeRunLivenessSweepAction,
  maybeRescoreAction,
} from '@/app/actions';

/**
 * The search, visible while it runs.
 *
 * The old version called a server action that did the whole sweep and returned
 * one number at the end. Everything worked; it just looked dead — a minute and
 * a half of nothing, which is what somebody demonstrating the tool has to fill
 * with apologies. The sweep now reports every source it starts and every flat
 * it finds, and this component puts each one on screen the moment it arrives.
 *
 * Nothing here decides anything. What appears while the search runs is a
 * preview; the real, ranked, filtered list underneath is re-rendered from the
 * database when the run finishes.
 */

interface LiveListing {
  id: string;
  title: string;
  url: string;
  city: string | null;
  imageUrl: string | null;
  priceCents: number | null;
  rooms: number | null;
  sqm: number | null;
  sourceName: string;
  isNew: boolean;
}

interface SourceState {
  name: string;
  state: 'waiting' | 'running' | 'ok' | 'blocked' | 'error';
  found: number;
  note: string | null;
}

/** More than this on screen at once and nobody reads any of them. */
const MAX_CARDS = 24;

export function LiveSearch({ candidateCaseId }: { candidateCaseId?: string } = {}) {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [phase, setPhase] = useState<string | null>(null);
  const [sources, setSources] = useState<Map<string, SourceState>>(new Map());
  const [cards, setCards] = useState<LiveListing[]>([]);
  const [foundTotal, setFoundTotal] = useState(0);
  const [createdTotal, setCreatedTotal] = useState(0);
  const [note, setNote] = useState<string | null>(null);
  const [lastRunAt, setLastRunAt] = useState<string | null>(null);
  const [enabledSources, setEnabledSources] = useState<number | null>(null);
  const startedOnce = useRef(false);

  const search = useCallback(
    async (force: boolean) => {
      setRunning(true);
      setNote(null);
      setPhase(null);
      setSources(new Map());
      setCards([]);
      setFoundTotal(0);
      setCreatedTotal(0);

      let ran = false;
      try {
        const res = await fetch(`/api/discovery/live${force ? '?force=1' : ''}`, {
          method: 'POST',
        });
        if (!res.ok || !res.body) {
          setNote('Suche konnte nicht gestartet werden.');
          return;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          // Everything up to the last newline is complete; the tail is half an
          // event and waits for the next chunk.
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';
          for (const line of lines) {
            if (!line.trim()) continue;
            let event: Record<string, unknown>;
            try {
              event = JSON.parse(line) as Record<string, unknown>;
            } catch {
              continue;
            }
            ran = applyEvent(event) || ran;
          }
        }
      } catch {
        setNote('Verbindung zur Suche abgebrochen.');
      } finally {
        setRunning(false);
        setPhase(null);
        // The preview above is unranked and unfiltered; the list underneath is
        // the real answer, so it is re-read once the run is over.
        if (ran) router.refresh();
      }

      function applyEvent(event: Record<string, unknown>): boolean {
        switch (event.type) {
          case 'start':
          case 'skipped': {
            setLastRunAt((event.lastRunAt as string | null) ?? null);
            setEnabledSources((event.enabledSources as number | null) ?? null);
            if (event.type === 'skipped') setPhase(null);
            return false;
          }
          case 'plan': {
            const planned = event.sources as Array<{ id: string; name: string }>;
            setSources(
              new Map(
                planned.map((s) => [s.id, { name: s.name, state: 'waiting', found: 0, note: null }]),
              ),
            );
            setPhase(`${planned.length} Quellen · ${event.queries as number} Suchen`);
            return false;
          }
          case 'source-start': {
            updateSource(event.sourceId as string, (s) => ({
              ...s,
              name: event.name as string,
              state: 'running',
            }));
            return false;
          }
          case 'source-done': {
            const status = event.status as string;
            updateSource(event.sourceId as string, (s) => ({
              ...s,
              name: event.name as string,
              state: status === 'OK' ? 'ok' : status === 'BLOCKED' ? 'blocked' : 'error',
              found: event.found as number,
              note: (event.note as string | null) ?? null,
            }));
            return false;
          }
          case 'listing': {
            const listing = event.listing as LiveListing;
            setFoundTotal((n) => n + 1);
            if (listing.isNew) setCreatedTotal((n) => n + 1);
            // Newest first, and bounded: this is a sign of life, not an
            // archive.
            setCards((prev) => [listing, ...prev].slice(0, MAX_CARDS));
            return true;
          }
          case 'phase': {
            const left = event.pending as number;
            setPhase(
              left > 0
                ? `alle Quellen durch, noch ${left} Detailseite(n) werden nachgelesen`
                : 'alle Quellen durch',
            );
            return true;
          }
          case 'done': {
            const summary = event.summary as { created: number; retired: number; notes: string[] };
            setLastRunAt(new Date().toISOString());
            setNote(
              summary.created > 0
                ? `${summary.created} neue Anzeige(n) gefunden${
                    summary.retired > 0 ? `, ${summary.retired} verschwundene entfernt` : ''
                  }.`
                : 'Fertig — nichts Neues.',
            );
            return true;
          }
          default:
            return false;
        }
      }

      function updateSource(id: string, patch: (s: SourceState) => SourceState) {
        setSources((prev) => {
          const next = new Map(prev);
          const current = next.get(id) ?? { name: id, state: 'waiting' as const, found: 0, note: null };
          next.set(id, patch(current));
          return next;
        });
      }
    },
    [router],
  );

  // On open: bring the list up to date, then search — but only if a search is
  // actually due, which the server decides.
  useEffect(() => {
    if (startedOnce.current) return;
    startedOnce.current = true;

    void (async () => {
      if (candidateCaseId) {
        try {
          await maybeRescoreAction(candidateCaseId);
        } catch {
          // A re-score must never block the page.
        }
      }
      try {
        await maybeRunLivenessSweepAction(candidateCaseId);
      } catch {
        // Same for the link check.
      }
      await search(false);
    })();
  }, [candidateCaseId, search]);

  const sourceList = [...sources.values()];
  const done = sourceList.filter((s) => s.state !== 'waiting' && s.state !== 'running').length;
  const blocked = sourceList.filter((s) => s.state === 'blocked');

  return (
    <div className="stack-sm">
      <div className={`freshness ${enabledSources === 0 ? 'warn' : ''}`}>
        <span className="freshness-dot" aria-hidden />
        <span className="freshness-text">
          {running
            ? phase
              ? `Sucht … ${phase}`
              : 'Sucht gerade nach neuen Anzeigen …'
            : enabledSources === 0
              ? 'Keine Quelle eingeschaltet — es wird nicht gesucht. Unter Einstellungen → Quellen einschalten.'
              : lastRunAt
                ? `Zuletzt gesucht: ${whenLabel(lastRunAt)}`
                : 'Noch nicht gesucht'}
          {note ? <strong className="freshness-note"> · {note}</strong> : null}
        </span>
        <button
          type="button"
          className="btn sm"
          onClick={() => void search(true)}
          disabled={running}
        >
          {running ? 'Sucht …' : 'Jetzt suchen'}
        </button>
      </div>

      {running || cards.length > 0 ? (
        <div className="live">
          <div className="live-head">
            <div className="live-counts">
              <span className="live-count">
                <strong>{foundTotal}</strong> gesehen
              </span>
              <span className="live-count accent">
                <strong>{createdTotal}</strong> neu
              </span>
              {sourceList.length > 0 ? (
                <span className="live-count subtle">
                  {done}/{sourceList.length} Quellen
                </span>
              ) : null}
            </div>
            {sourceList.length > 0 ? (
              <div className="live-bar" aria-hidden>
                <span style={{ width: `${Math.round((done / sourceList.length) * 100)}%` }} />
              </div>
            ) : null}
          </div>

          {sourceList.length > 0 ? (
            <div className="live-sources">
              {sourceList.map((s) => (
                <span
                  key={s.name}
                  className={`live-source ${s.state}`}
                  title={s.note ?? undefined}
                >
                  <span className="live-source-dot" aria-hidden />
                  {s.name}
                  {s.state === 'ok' && s.found > 0 ? <em>{s.found}</em> : null}
                </span>
              ))}
            </div>
          ) : null}

          {cards.length > 0 ? (
            <div className="live-grid">
              {cards.map((c) => (
                <a
                  key={c.id}
                  href={c.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`live-card ${c.isNew ? 'is-new' : ''}`}
                >
                  <span className="live-thumb">
                    {c.imageUrl ? (
                      // Portal images, from hosts we do not control — plain
                      // <img> so no image proxy has to be configured per portal,
                      // and no referrer is leaked back to the site.
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={c.imageUrl} alt="" loading="lazy" referrerPolicy="no-referrer" />
                    ) : (
                      <span className="live-thumb-empty" aria-hidden>
                        ⌂
                      </span>
                    )}
                    {c.isNew ? <span className="live-new">neu</span> : null}
                  </span>
                  <span className="live-card-body">
                    <span className="live-card-title">{c.title}</span>
                    <span className="live-card-facts">
                      {c.priceCents != null ? (
                        <strong>{formatEuroCents(c.priceCents)}</strong>
                      ) : (
                        <span className="subtle">Preis unbekannt</span>
                      )}
                      {c.rooms != null ? <span>{c.rooms} Zi.</span> : null}
                      {c.sqm != null ? <span>{c.sqm} m²</span> : null}
                    </span>
                    <span className="live-card-meta">
                      {[c.city, c.sourceName].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                </a>
              ))}
            </div>
          ) : running ? (
            <p className="small muted" style={{ padding: '2px 2px 4px' }}>
              Die Portale werden der Reihe nach abgefragt — die ersten Treffer erscheinen hier, sobald
              sie da sind.
            </p>
          ) : null}

          {blocked.length > 0 && !running ? (
            <p className="small muted">
              {blocked.map((b) => b.name).join(', ')}{' '}
              {blocked.length === 1 ? 'blockiert' : 'blockieren'} automatische Abrufe — dort hilft nur
              der Suchauftrag per E-Mail.
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/**
 * "heute 21:40" rather than a date. The question this line answers is "is what
 * I am looking at from today?", and a bare timestamp makes the reader do the
 * subtraction.
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
