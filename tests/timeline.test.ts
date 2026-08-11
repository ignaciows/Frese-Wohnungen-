import { describe, expect, it } from 'vitest';
import { buildTimeline, type TimelineFlat, type TimelineInput } from '@/domain/timeline';

const NOW = new Date('2026-09-15T10:00:00Z');
const d = (iso: string) => new Date(iso);

function flat(over: Partial<TimelineFlat> = {}): TimelineFlat {
  return {
    id: 'l1',
    title: '2-Zimmer-Wohnung',
    city: 'Heilbronn',
    imageUrl: null,
    priceCents: 78000,
    availableFrom: null,
    contactedAt: null,
    repliedAt: null,
    outcome: 'AWAITING',
    viewingAt: null,
    secured: false,
    ...over,
  };
}

function input(over: Partial<TimelineInput> = {}): TimelineInput {
  return {
    now: NOW,
    contractSignedAt: d('2026-08-01T00:00:00Z'),
    arrival: d('2026-11-01T00:00:00Z'),
    housingSecuredAt: null,
    flats: [],
    ...over,
  };
}

describe('timeline axis', () => {
  it('covers every date it was given', () => {
    const t = buildTimeline(
      input({ flats: [flat({ contactedAt: d('2026-09-10T00:00:00Z'), availableFrom: d('2026-12-01T00:00:00Z') })] }),
    );
    expect(t.from.getTime()).toBeLessThanOrEqual(d('2026-08-01T00:00:00Z').getTime());
    expect(t.to.getTime()).toBeGreaterThanOrEqual(d('2026-12-01T00:00:00Z').getTime());
  });

  it('keeps a span wide enough to separate two nearby dates', () => {
    // Contract and arrival three days apart would otherwise collapse onto the
    // same pixel.
    const t = buildTimeline(
      input({ contractSignedAt: d('2026-09-14T00:00:00Z'), arrival: d('2026-09-17T00:00:00Z'), flats: [] }),
    );
    const today = t.markers.find((m) => m.key === 'today')!;
    const arrival = t.markers.find((m) => m.key === 'arrival')!;
    expect(arrival.pct - today.pct).toBeLessThan(20);
    expect(t.to.getTime() - t.from.getTime()).toBeGreaterThan(55 * 86_400_000);
  });

  it('places markers in chronological order along the axis', () => {
    const t = buildTimeline(input());
    const pct = (k: string) => t.markers.find((m) => m.key === k)!.pct;
    expect(pct('contract')).toBeLessThan(pct('today'));
    expect(pct('today')).toBeLessThan(pct('arrival'));
    expect(pct('arrival')).toBeLessThanOrEqual(100);
  });

  it('labels one month tick per month', () => {
    const t = buildTimeline(input());
    expect(t.months.length).toBeGreaterThanOrEqual(3);
    expect(t.months[0].pct).toBe(0);
  });
});

describe('countdown', () => {
  it('counts the days that are left', () => {
    expect(buildTimeline(input()).daysToArrival).toBe(47);
  });

  it('goes negative once the person has arrived', () => {
    const t = buildTimeline(input({ arrival: d('2026-09-01T00:00:00Z') }));
    expect(t.daysToArrival).toBe(-14);
    expect(t.headline).toContain('Angekommen seit 14 Tagen');
  });

  it('says so when there is no arrival date at all', () => {
    const t = buildTimeline(input({ arrival: null, contractSignedAt: null }));
    expect(t.stage).toBe('NO_DATES');
    expect(t.daysToArrival).toBeNull();
  });
});

describe('flat tracks', () => {
  it('reads an enquiry with no answer as still waiting', () => {
    const t = buildTimeline(input({ flats: [flat({ contactedAt: d('2026-09-10T00:00:00Z') })] }));
    expect(t.tracks[0].stage).toBe('SENT');
    expect(t.stage).toBe('WAITING');
    expect(t.headline).toContain('1 Anfrage wartet');
  });

  it('promotes a flat with a booked viewing above one that only answered', () => {
    const t = buildTimeline(
      input({
        flats: [
          flat({ id: 'answered', contactedAt: d('2026-09-01T00:00:00Z'), repliedAt: d('2026-09-05T00:00:00Z'), outcome: 'POSITIVE' }),
          flat({ id: 'viewing', contactedAt: d('2026-09-02T00:00:00Z'), viewingAt: d('2026-09-20T00:00:00Z') }),
        ],
      }),
    );
    expect(t.tracks.map((x) => x.flat.id)).toEqual(['viewing', 'answered']);
    expect(t.stage).toBe('PROMISING');
  });

  it('sinks a rejection to the bottom and closes its bar', () => {
    const t = buildTimeline(
      input({
        flats: [
          flat({ id: 'no', contactedAt: d('2026-09-01T00:00:00Z'), repliedAt: d('2026-09-03T00:00:00Z'), outcome: 'NEGATIVE' }),
          flat({ id: 'open', contactedAt: d('2026-09-02T00:00:00Z') }),
        ],
      }),
    );
    expect(t.tracks[t.tracks.length - 1].flat.id).toBe('no');
    const declined = t.tracks.find((x) => x.flat.id === 'no')!;
    const open = t.tracks.find((x) => x.flat.id === 'open')!;
    // The rejected one stops when it was rejected; the open one runs to today.
    expect(declined.endPct).toBeLessThan(open.endPct);
  });

  it('measures the gap between a flat being free and the person landing', () => {
    const t = buildTimeline(
      input({
        arrival: d('2026-11-01T00:00:00Z'),
        flats: [flat({ contactedAt: d('2026-09-10T00:00:00Z'), availableFrom: d('2026-11-15T00:00:00Z') })],
      }),
    );
    // Free two weeks after arrival: a gap that has to be bridged.
    expect(t.tracks[0].gapDays).toBe(14);
  });

  it('reports a flat free before arrival as a negative gap', () => {
    const t = buildTimeline(
      input({ flats: [flat({ contactedAt: NOW, availableFrom: d('2026-10-01T00:00:00Z') })] }),
    );
    expect(t.tracks[0].gapDays).toBe(-31);
  });

  it('says plainly when the advert names no date', () => {
    const t = buildTimeline(input({ flats: [flat({ contactedAt: NOW })] }));
    expect(t.tracks[0].readyLabel).toBe('Kein Datum in der Anzeige');
    expect(t.tracks[0].gapDays).toBeNull();
  });
});

describe('secured case', () => {
  it('stops counting down once housing is secured', () => {
    const t = buildTimeline(
      input({
        housingSecuredAt: d('2026-09-12T00:00:00Z'),
        flats: [flat({ contactedAt: d('2026-09-01T00:00:00Z'), secured: true, outcome: 'POSITIVE' })],
      }),
    );
    expect(t.stage).toBe('SECURED');
    expect(t.headline).toBe('Wohnung ist gesichert.');
    expect(t.markers.some((m) => m.key === 'secured')).toBe(true);
    expect(t.tracks[0].stage).toBe('AGREED');
  });
});
