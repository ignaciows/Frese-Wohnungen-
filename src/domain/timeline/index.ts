/**
 * The housing search as a line, left to right.
 *
 * A candidate case is a race between two dates: the day the person lands in
 * Germany and the day some flat is actually free. Everything else on the
 * candidate screen — counts of enquiries, tabs, badges — describes the work,
 * not the race, and a colleague looking at it still could not say whether they
 * were early or late. This module turns the dates the case already holds into
 * positions on one axis, so "there are five weeks left and the two flats that
 * answered are both free too late" is something you see rather than work out.
 *
 * Pure and dateless: `now` is passed in. Everything here is arithmetic on
 * dates, which makes it testable without a database and keeps the component
 * that draws it free of rules.
 */

export type FlatOutcome = 'AWAITING' | 'POSITIVE' | 'NEGATIVE' | 'NEEDS_INFO';

export interface TimelineFlat {
  id: string;
  title: string;
  city: string | null;
  imageUrl: string | null;
  priceCents: number | null;
  /** When the flat can be moved into, as the advert states it. */
  availableFrom: Date | null;
  /** When we wrote to the landlord. Null for a flat nobody has contacted. */
  contactedAt: Date | null;
  /** When an answer was recorded, whatever the answer was. */
  repliedAt: Date | null;
  outcome: FlatOutcome;
  /** Next viewing or video call for this flat, when one is booked. */
  viewingAt: Date | null;
  /** True for the flat the case was closed with. */
  secured: boolean;
}

export interface TimelineInput {
  now: Date;
  /** Employment contract signed — the day the housing clock starts. */
  contractSignedAt: Date | null;
  /** The day the person arrives; the flat has to exist by then. */
  arrival: Date | null;
  housingSecuredAt: Date | null;
  flats: TimelineFlat[];
}

export type TrackStage = 'SENT' | 'REPLIED' | 'VIEWING' | 'AGREED' | 'DECLINED';

export interface TimelineEvent {
  kind: 'sent' | 'reply' | 'viewing' | 'available';
  at: Date;
  pct: number;
  label: string;
}

export interface TimelineTrack {
  flat: TimelineFlat;
  stage: TrackStage;
  /** Where the bar starts and ends, in percent of the whole axis. */
  startPct: number;
  endPct: number;
  events: TimelineEvent[];
  /** "Frei ab 1.9." — or why that cannot be said. */
  readyLabel: string;
  /**
   * Days between the flat being free and the person arriving. Negative means
   * the flat is free before they land (good), positive means a gap to bridge.
   */
  gapDays: number | null;
}

export type TimelineMarkerKey = 'contract' | 'today' | 'arrival' | 'secured';

export interface TimelineMarker {
  key: TimelineMarkerKey;
  at: Date;
  pct: number;
  label: string;
}

export type CaseStage = 'NO_DATES' | 'SEARCHING' | 'WAITING' | 'PROMISING' | 'SECURED';

/**
 * How close this case is to the day somebody arrives with nowhere to go.
 *
 * Not a mood: it is the difference between "there is time" and "this is the
 * one to work on today". A flat has to be found, written to, viewed and signed
 * — six weeks is comfortable, three is tight, and inside three weeks with
 * nothing agreed somebody is about to pay for a hotel.
 */
export type RiskLevel = 'CALM' | 'WATCH' | 'DANGER';

/** Inside this many days before the arrival, an unsolved case is in trouble. */
export const DANGER_DAYS = 21;
export const WATCH_DAYS = 45;

export function riskOf(daysToArrival: number | null, secured: boolean): RiskLevel {
  if (secured) return 'CALM';
  if (daysToArrival == null) return 'CALM';
  if (daysToArrival <= DANGER_DAYS) return 'DANGER';
  if (daysToArrival <= WATCH_DAYS) return 'WATCH';
  return 'CALM';
}

export interface TimelineView {
  from: Date;
  to: Date;
  months: Array<{ at: Date; label: string; pct: number }>;
  markers: TimelineMarker[];
  tracks: TimelineTrack[];
  /** Positive = arrival still ahead, negative = they are already here. */
  daysToArrival: number | null;
  stage: CaseStage;
  /** The one sentence above the line. */
  headline: string;
  risk: RiskLevel;
  /** Where the danger zone starts on the axis, in percent. Null without an arrival. */
  dangerFromPct: number | null;
  arrivalPct: number | null;
}

const DAY = 86_400_000;

/**
 * Everything the axis has to cover, plus enough air at both ends that a marker
 * on the first or last day is not drawn half outside the box.
 */
export function buildTimeline(input: TimelineInput): TimelineView {
  const { now } = input;
  const dates: Date[] = [now];
  if (input.contractSignedAt) dates.push(input.contractSignedAt);
  if (input.arrival) dates.push(input.arrival);
  if (input.housingSecuredAt) dates.push(input.housingSecuredAt);
  for (const f of input.flats) {
    if (f.contactedAt) dates.push(f.contactedAt);
    if (f.repliedAt) dates.push(f.repliedAt);
    if (f.viewingAt) dates.push(f.viewingAt);
    if (f.availableFrom) dates.push(f.availableFrom);
  }

  const earliest = new Date(Math.min(...dates.map((d) => d.getTime())));
  const latest = new Date(Math.max(...dates.map((d) => d.getTime())));

  // A line covering three days would put "today" and "arrival" on top of each
  // other, so there is a floor on how short it can be.
  const from = startOfMonth(new Date(earliest.getTime() - 5 * DAY));
  const minTo = new Date(from.getTime() + 60 * DAY);
  const to = endOfMonth(new Date(Math.max(latest.getTime() + 5 * DAY, minTo.getTime())));

  const span = Math.max(1, to.getTime() - from.getTime());
  const pctOf = (d: Date): number =>
    Math.min(100, Math.max(0, ((d.getTime() - from.getTime()) / span) * 100));

  const markers: TimelineMarker[] = [];
  if (input.contractSignedAt) {
    markers.push({
      key: 'contract',
      at: input.contractSignedAt,
      pct: pctOf(input.contractSignedAt),
      label: 'Vertrag',
    });
  }
  markers.push({ key: 'today', at: now, pct: pctOf(now), label: 'Heute' });
  if (input.arrival) {
    markers.push({ key: 'arrival', at: input.arrival, pct: pctOf(input.arrival), label: 'Ankunft' });
  }
  if (input.housingSecuredAt) {
    markers.push({
      key: 'secured',
      at: input.housingSecuredAt,
      pct: pctOf(input.housingSecuredAt),
      label: 'Wohnung sicher',
    });
  }

  const tracks = input.flats
    .map((flat) => buildTrack(flat, input, pctOf))
    // The flats furthest along the process first: an answer outranks an
    // enquiry, and a booked viewing outranks both.
    .sort((a, b) => stageRank(a.stage) - stageRank(b.stage) || a.startPct - b.startPct);

  const daysToArrival = input.arrival ? Math.round(diffDays(input.arrival, now)) : null;
  const stage = caseStage(input);
  const risk = riskOf(daysToArrival, stage === 'SECURED');
  const arrivalPct = input.arrival ? pctOf(input.arrival) : null;
  const dangerFromPct = input.arrival
    ? pctOf(new Date(input.arrival.getTime() - DANGER_DAYS * DAY))
    : null;

  return {
    from,
    to,
    months: monthTicks(from, to, pctOf),
    markers,
    tracks,
    daysToArrival,
    stage,
    headline: headlineFor(stage, daysToArrival, tracks),
    risk,
    dangerFromPct,
    arrivalPct,
  };
}

function buildTrack(
  flat: TimelineFlat,
  input: TimelineInput,
  pctOf: (d: Date) => number,
): TimelineTrack {
  const events: TimelineEvent[] = [];
  if (flat.contactedAt) {
    events.push({
      kind: 'sent',
      at: flat.contactedAt,
      pct: pctOf(flat.contactedAt),
      label: `Anfrage ${formatShort(flat.contactedAt)}`,
    });
  }
  if (flat.repliedAt) {
    events.push({
      kind: 'reply',
      at: flat.repliedAt,
      pct: pctOf(flat.repliedAt),
      label: `${outcomeWord(flat.outcome)} ${formatShort(flat.repliedAt)}`,
    });
  }
  if (flat.viewingAt) {
    events.push({
      kind: 'viewing',
      at: flat.viewingAt,
      pct: pctOf(flat.viewingAt),
      label: `Termin ${formatShort(flat.viewingAt)}`,
    });
  }
  if (flat.availableFrom) {
    events.push({
      kind: 'available',
      at: flat.availableFrom,
      pct: pctOf(flat.availableFrom),
      label: `Frei ab ${formatShort(flat.availableFrom)}`,
    });
  }

  const stage: TrackStage = flat.secured
    ? 'AGREED'
    : flat.outcome === 'NEGATIVE'
      ? 'DECLINED'
      : flat.viewingAt
        ? 'VIEWING'
        : flat.outcome === 'POSITIVE' || flat.repliedAt
          ? 'REPLIED'
          : 'SENT';

  // The bar runs from the first thing that happened to the last, and at least
  // to today while the conversation is still open — a hairline at one date
  // says nothing about how long this has been going on.
  const startAt = flat.contactedAt ?? flat.availableFrom ?? input.now;
  const openEnd = stage !== 'DECLINED' && stage !== 'AGREED';
  const endCandidates = [
    flat.viewingAt?.getTime(),
    flat.repliedAt?.getTime(),
    openEnd ? input.now.getTime() : undefined,
    flat.availableFrom?.getTime(),
  ].filter((n): n is number => n != null);
  const endAt = new Date(Math.max(startAt.getTime(), ...endCandidates));

  const gapDays =
    flat.availableFrom && input.arrival ? Math.round(diffDays(flat.availableFrom, input.arrival)) : null;

  return {
    flat,
    stage,
    startPct: pctOf(startAt),
    endPct: pctOf(endAt),
    events,
    readyLabel: flat.availableFrom
      ? `Frei ab ${formatShort(flat.availableFrom)}`
      : 'Kein Datum in der Anzeige',
    gapDays,
  };
}

function stageRank(stage: TrackStage): number {
  return { AGREED: 0, VIEWING: 1, REPLIED: 2, SENT: 3, DECLINED: 4 }[stage];
}

function caseStage(input: TimelineInput): CaseStage {
  if (input.housingSecuredAt) return 'SECURED';
  if (input.flats.some((f) => f.outcome === 'POSITIVE' || f.viewingAt)) return 'PROMISING';
  if (input.flats.some((f) => f.contactedAt && f.outcome === 'AWAITING')) return 'WAITING';
  if (!input.arrival && !input.contractSignedAt) return 'NO_DATES';
  return 'SEARCHING';
}

/**
 * The sentence above the line.
 *
 * Says the one thing the line is about — how much time is left — and never
 * more than one thing, because a headline with two clauses is read as neither.
 */
function headlineFor(
  stage: CaseStage,
  daysToArrival: number | null,
  tracks: TimelineTrack[],
): string {
  if (stage === 'SECURED') return 'Wohnung ist gesichert.';
  if (daysToArrival == null) {
    return stage === 'NO_DATES'
      ? 'Kein Ankunftsdatum hinterlegt — ohne das lässt sich nicht sagen, wie viel Zeit bleibt.'
      : 'Kein Ankunftsdatum hinterlegt.';
  }
  if (daysToArrival < 0) {
    return `Angekommen seit ${Math.abs(daysToArrival)} Tagen — es gibt noch keine Wohnung.`;
  }
  const weeks = Math.round(daysToArrival / 7);
  const time =
    daysToArrival === 0
      ? 'Ankunft ist heute'
      : daysToArrival <= 21
        ? `Noch ${daysToArrival} Tage bis zur Ankunft`
        : `Noch ${weeks} Wochen bis zur Ankunft`;

  const ready = tracks.filter((t) => t.stage === 'VIEWING' || t.stage === 'REPLIED').length;
  if (ready > 0) return `${time} · ${ready} ${ready === 1 ? 'Zusage/Antwort' : 'Antworten'} in Arbeit`;
  const waiting = tracks.filter((t) => t.stage === 'SENT').length;
  if (waiting > 0) {
    return `${time} · ${waiting} ${waiting === 1 ? 'Anfrage wartet' : 'Anfragen warten'} auf Antwort`;
  }
  return `${time} · noch keine Anfrage draußen`;
}

/* ------------------------------------------------------------ helpers --- */

function monthTicks(
  from: Date,
  to: Date,
  pctOf: (d: Date) => number,
): Array<{ at: Date; label: string; pct: number }> {
  const ticks: Array<{ at: Date; label: string; pct: number }> = [];
  const cursor = startOfMonth(from);
  // A year of months still fits; beyond that the labels would collide, so only
  // every second one is drawn.
  const months = monthsBetween(from, to);
  const step = months > 14 ? 2 : 1;
  let i = 0;
  while (cursor <= to) {
    if (i % step === 0) {
      ticks.push({
        at: new Date(cursor),
        label: cursor.toLocaleDateString('de-DE', { month: 'short' }),
        pct: pctOf(new Date(cursor)),
      });
    }
    cursor.setMonth(cursor.getMonth() + 1);
    i++;
  }
  return ticks;
}

function monthsBetween(a: Date, b: Date): number {
  return (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
}

export function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

export function endOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59);
}

function diffDays(a: Date, b: Date): number {
  return (startOfDay(a).getTime() - startOfDay(b).getTime()) / DAY;
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function formatShort(d: Date): string {
  return d.toLocaleDateString('de-DE', { day: 'numeric', month: 'short' });
}

function outcomeWord(outcome: FlatOutcome): string {
  switch (outcome) {
    case 'POSITIVE':
      return 'Zusage';
    case 'NEGATIVE':
      return 'Absage';
    case 'NEEDS_INFO':
      return 'Rückfrage';
    default:
      return 'Antwort';
  }
}
