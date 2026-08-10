/**
 * "Did the source answer about the town we asked about?"
 *
 * A portal search is addressed by an internal town number, and getting that
 * number wrong does not produce an error — it produces a full, healthy-looking
 * page of adverts about somewhere else. A live sweep asked Kleinanzeigen for
 * Cologne while carrying Heilbronn's number and got back a hundred and three
 * results, every one of them in Heilbronn, and the run recorded itself as OK.
 * Nothing downstream could tell: the adverts were real, the parse was clean,
 * and the ranking dutifully explained to a Cologne candidate that each of them
 * was three hundred kilometres away.
 *
 * The candidate's own postcode is the check. It costs nothing, needs no
 * gazetteer, and catches the case that actually happens — a whole batch from
 * the wrong part of the country — while staying quiet about the cases it
 * cannot judge.
 */

export interface LocationSanity {
  ok: boolean;
  /** German, for the discovery log. Null when there was nothing to check. */
  note: string | null;
}

/** How many of a batch must carry a postcode before its spread means anything. */
const MIN_SAMPLE = 8;

/**
 * A batch is rejected when nearly all of it sits in a different postal zone
 * from the workplace.
 *
 * The first digit, not the first two: neighbouring towns routinely differ in
 * the second (Heilbronn 74 borders Stuttgart 70), and rejecting those would
 * throw away exactly the commutable ring the search is meant to cover. A
 * difference in the first digit is a different corner of the country.
 */
export function checkBatchLocation(
  requestedPostal: string | null | undefined,
  returnedPostals: Array<string | null | undefined>,
): LocationSanity {
  const wanted = (requestedPostal ?? '').trim();
  if (!/^\d{5}$/.test(wanted)) return { ok: true, note: null };

  const codes = returnedPostals
    .map((c) => (c ?? '').trim())
    .filter((c) => /^\d{5}$/.test(c));
  if (codes.length < MIN_SAMPLE) return { ok: true, note: null };

  const sameZone = codes.filter((c) => c[0] === wanted[0]).length;
  const share = sameZone / codes.length;

  // A tenth is generous on purpose. A correct search occasionally reaches over
  // a zone boundary, but it cannot be that nine adverts in ten are in another
  // part of Germany unless the wrong place was asked about.
  if (share >= 0.1) {
    return { ok: true, note: null };
  }

  const zones = [...new Set(codes.map((c) => c.slice(0, 2)))].sort().slice(0, 4).join(', ');
  return {
    ok: false,
    note:
      `Antwort passt nicht zum gesuchten Ort: ${codes.length} Treffer, davon ${sameZone} in der PLZ-Zone ${wanted[0]}x. ` +
      `Zurückgekommen sind vor allem ${zones}. Die Ortsnummer der Quelle zeigt auf eine andere Stadt — Treffer verworfen.`,
  };
}
