/**
 * Reading the posting date out of a source's result list.
 *
 * The detail-page reader covers ads we fetch individually, but only a bounded
 * number get fetched per sweep — so without this most of the pool would carry
 * no date at all, and "posted twenty minutes ago" versus "posted three weeks
 * ago" is the difference between a phone call and a waste of time.
 */

import { describe, expect, it } from 'vitest';
import { listPostedAt } from '@/domain/discovery/listPostedAt';
import { parseRelative } from '@/domain/liveness/postedAt';
import { kleinanzeigenAdapter } from '@/domain/discovery/adapters/kleinanzeigen';
import { telegramAdapter } from '@/domain/discovery/adapters/telegram';
import type { FetchedPage } from '@/domain/discovery/types';

const now = new Date('2026-08-10T12:00:00Z');

describe('listPostedAt', () => {
  it('reads the German date Kleinanzeigen prints', () => {
    const r = listPostedAt('05.08.2026', now);
    expect(r?.at.getUTCDate()).toBe(5);
    expect(r?.label).toContain('05.08.2026');
  });

  it('reads an ISO timestamp', () => {
    expect(listPostedAt('2026-08-09T08:00:20+00:00', now)?.at.getUTCDate()).toBe(9);
  });

  it('refuses a guess rather than inventing a date', () => {
    // An invented date is worse than none: the field exists to decide how
    // urgently to act on the ad.
    expect(listPostedAt('demnächst', now)).toBeNull();
    expect(listPostedAt('', now)).toBeNull();
    expect(listPostedAt(null, now)).toBeNull();
  });

  it('rejects dates outside the plausible window', () => {
    expect(listPostedAt('01.01.2019', now)).toBeNull();
    expect(listPostedAt('01.01.2027', now)).toBeNull();
  });
});

describe('"Heute" is anchored to the start of the day', () => {
  it('never reports an ad posted this morning as brand new', () => {
    // Kleinanzeigen labels everything posted today "Heute". Reading that as
    // "just now" made 18 ads in a live sweep all claim to be two minutes old,
    // which destroys the signal the field exists to carry.
    const at = parseRelative('heute', now);
    expect(at?.toISOString()).toBe('2026-08-10T00:00:00.000Z');
  });

  it('anchors "gestern" the same way', () => {
    expect(parseRelative('gestern', now)?.toISOString()).toBe('2026-08-09T00:00:00.000Z');
  });

  it('still labels them as humans say them', () => {
    expect(listPostedAt('heute', now)?.label).toContain('heute');
    expect(listPostedAt('gestern', now)?.label).toContain('gestern');
  });
});

describe('adapters supply the date from the list', () => {
  const page = (body: string, url: string): FetchedPage => ({
    url,
    finalUrl: url,
    status: 200,
    body,
    error: null,
    blocked: false,
  });

  it('Kleinanzeigen carries its sortingDate through', () => {
    const body = JSON.stringify({
      searchForm: { priceLabelMessageKey: 'Kaltmiete' },
      result: {
        resultList: [
          {
            organicAdPreview: {
              title: '2-Zimmer-Wohnung in Heilbronn',
              seoLink: '/s-anzeige/test/1234-203-9228',
              price: '780 €',
              locationName: '74072',
              parentLocationName: 'Heilbronn',
              attributes: ['62 m²', '2 Zi.'],
              sortingDate: '05.08.2026',
            },
          },
        ],
      },
    });
    const items = kleinanzeigenAdapter.parse(page(body, 'https://www.kleinanzeigen.de/x/c203l9228'), {});
    expect(items[0].postedAt?.at.getUTCDate()).toBe(5);
  });

  it('Telegram carries each post\'s own timestamp', () => {
    const body = `<div class="tgme_widget_message js-widget_message" data-post="wohnungenberlin/99">
      <a class="tgme_widget_message_date"><time datetime="2026-08-09T10:15:00+00:00"></time></a>
      <div class="tgme_widget_message_text js-message_text">2-Zimmer-Wohnung in Berlin, 68 m², 900 € warm</div>
    </div>`;
    const items = telegramAdapter.parse(page(body, 'https://t.me/s/wohnungenberlin'), {});
    expect(items).toHaveLength(1);
    expect(items[0].postedAt?.at.toISOString()).toBe('2026-08-09T10:15:00.000Z');
  });

  it('an ad without a stated date simply has none', () => {
    const body = JSON.stringify({
      result: {
        resultList: [
          {
            organicAdPreview: {
              title: '2-Zimmer-Wohnung',
              seoLink: '/s-anzeige/test/1234-203-9228',
              price: '780 €',
            },
          },
        ],
      },
    });
    const items = kleinanzeigenAdapter.parse(page(body, 'https://www.kleinanzeigen.de/x/c203l9228'), {});
    expect(items[0].postedAt ?? null).toBeNull();
  });
});
