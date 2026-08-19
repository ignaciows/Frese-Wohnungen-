/**
 * Der Takt — und der eine Fehler, den man ihm nicht ansieht.
 *
 * In der Produktion war keine Quelle eingeschaltet. Der Suchlauf brach deshalb
 * mit „übersprungen" ab, und weil an dieser Stelle ein `return` stand, endete
 * damit der **ganze** Durchgang: Kontaktdaten wurden nie nachgelesen, das
 * Postfach nie geöffnet. Zu sehen war davon nichts — ein stiller Takt sieht aus
 * wie ein ruhiger.
 *
 * Deshalb prüft dieser Test nicht, was der Takt tut, sondern dass ein Schritt
 * ohne Arbeit die folgenden nicht mitnimmt.
 */

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ensureMigrated, truncateAll } from './setup';

beforeAll(() => {
  ensureMigrated();
});

beforeEach(async () => {
  await truncateAll();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

describe('ein Durchgang', () => {
  it('liest Kontaktdaten nach, auch wenn der Suchlauf übersprungen wird', async () => {
    // Ohne eingeschaltete Quelle wird nicht gesucht. Genau die Lage in der
    // Produktion, und genau die, in der vorher alles Weitere ausfiel.
    const backfill = vi.fn(async () => ({ scanned: 0, phonesFound: 0, remaining: 0 }));
    const mailbox = vi.fn(async () => ({
      configured: false,
      examined: 0,
      processed: 0,
      listingsCreated: 0,
      skipped: 0,
      errors: 0,
      messages: [],
    }));

    vi.doMock('@/server/contactBackfill', () => ({ backfillContacts: backfill }));
    vi.doMock('@/server/mailIngest', () => ({ ingestAllMailboxes: mailbox }));

    const { runTick } = await import('@/instrumentation');
    await runTick();

    expect(backfill, 'Nachlauf muss laufen, auch ohne Suchlauf').toHaveBeenCalled();
    expect(mailbox, 'Postfach muss gelesen werden, auch ohne Suchlauf').toHaveBeenCalled();
  });

  it('macht weiter, wenn ein Schritt scheitert', async () => {
    // Ein kaputtes Postfach darf den Nachlauf nicht mitnehmen und umgekehrt.
    const mailbox = vi.fn(async () => {
      throw new Error('IMAP kaputt');
    });
    const backfill = vi.fn(async () => ({ scanned: 3, phonesFound: 1, remaining: 0 }));

    vi.doMock('@/server/contactBackfill', () => ({ backfillContacts: backfill }));
    vi.doMock('@/server/mailIngest', () => ({ ingestAllMailboxes: mailbox }));
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    const { runTick } = await import('@/instrumentation');
    await expect(runTick()).resolves.toBeUndefined();

    expect(backfill).toHaveBeenCalled();
    expect(mailbox).toHaveBeenCalled();
  });
});
