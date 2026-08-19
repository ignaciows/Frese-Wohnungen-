/**
 * Telefonnummern aus dem Bestand nachlesen.
 *
 * Die Nummer wird beim Import aus dem Anzeigentext gelesen. Was vorher
 * importiert wurde, hat deshalb keine — und weil eine Anzeige ihre Detailseite
 * nur ein einziges Mal lesen lässt (`lastCheckedAt: null` im Suchlauf), wäre
 * das für immer so geblieben. Auf dem Bildschirm sah das aus wie eine Funktion,
 * die nicht funktioniert: kein einziger grüner „Anrufen"-Knopf, obwohl auf
 * Kleinanzeigen jede dritte Anzeige eine Nummer im Text hat.
 *
 * Der Nachlauf kostet nichts: der Anzeigentext liegt schon in der Datenbank,
 * es wird kein Portal noch einmal aufgerufen. `contactScannedAt` sorgt dafür,
 * dass jede Anzeige genau einmal drankommt und der Bestand irgendwann durch
 * ist, statt bei jedem Durchlauf erneut durchsucht zu werden.
 */

import { prisma } from '@/lib/prisma';
import { findContact } from '@/domain/contact';

/** Wie viele Anzeigen ein Durchgang anfasst. Bewusst klein — es eilt nicht. */
export const BACKFILL_BATCH = 400;

export interface BackfillResult {
  /** Wie viele Anzeigen durchsucht wurden. */
  scanned: number;
  /** Bei wie vielen dabei eine Telefonnummer herauskam. */
  phonesFound: number;
  /** Wie viele noch warten. */
  remaining: number;
}

/**
 * Durchsucht bis zu `limit` noch nie durchsuchte Anzeigen.
 *
 * Überschreibt nie etwas Vorhandenes: Wer eine Nummer von Hand eingetragen
 * hat, behält sie. Der Zeitstempel wird auch dann gesetzt, wenn nichts gefunden
 * wurde — sonst käme dieselbe Anzeige bei jedem Durchgang wieder.
 */
export async function backfillContacts(limit = BACKFILL_BATCH): Promise<BackfillResult> {
  const pending = await prisma.listing.findMany({
    where: { contactScannedAt: null },
    orderBy: { importedAt: 'desc' },
    take: limit,
    select: { id: true, title: true, descriptionRaw: true, contactPhone: true, contactEmail: true, contactName: true },
  });

  let phonesFound = 0;
  for (const l of pending) {
    const found = findContact(`${l.title}\n${l.descriptionRaw}`);
    if (found.phone && !l.contactPhone) phonesFound += 1;

    await prisma.listing.update({
      where: { id: l.id },
      data: {
        contactScannedAt: new Date(),
        // Nur füllen, nie überschreiben.
        ...(l.contactPhone ? {} : found.phone ? { contactPhone: found.phone } : {}),
        ...(l.contactEmail ? {} : found.email ? { contactEmail: found.email } : {}),
        ...(l.contactName ? {} : found.name ? { contactName: found.name } : {}),
      },
    });
  }

  return {
    scanned: pending.length,
    phonesFound,
    remaining: await prisma.listing.count({ where: { contactScannedAt: null } }),
  };
}
