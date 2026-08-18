/**
 * Finding a way to reach the landlord, from whatever the advert happens to say.
 *
 * Why this exists: the portal contact form is the slow route. A form message
 * lands in an inbox with forty others and gets answered on Thursday. A phone
 * number printed in the ad text gets answered in ten minutes — and for the
 * flats worth having, ten minutes against Thursday is the whole difference.
 *
 * Plenty of private landlords print their number ("Tel. 0176 / 1234567",
 * "Bitte nur per WhatsApp", "Rückruf unter 07131-98765"). Nothing read it, so
 * whoever was working the list had to open every ad and look. Now the parser
 * does it once and the result sits on the card.
 *
 * Two things this deliberately does NOT do:
 *
 *  - It never guesses. A string that is not clearly a German phone number is
 *    dropped. A wrong number costs a colleague a call to a stranger, which is
 *    far worse than an empty field.
 *  - It only ever reads what the advert itself published. Nothing is looked up
 *    anywhere else, and nothing is scraped from behind a login.
 */

/** What an advert told us about reaching the person behind it. */
export interface ContactDetails {
  /** Normalised German number, e.g. "+49 176 12345678". Null when none found. */
  phone: string | null;
  email: string | null;
  /** "Herr Müller", "Hausverwaltung Nord" — only when the ad names someone. */
  name: string | null;
}

export const NO_CONTACT: ContactDetails = { phone: null, email: null, name: null };

/* ----------------------------------------------------------- phone ------ */

/**
 * Candidate phone numbers. Deliberately loose — every match is validated
 * afterwards, and it is easier to reason about one permissive pattern plus
 * strict rules than about one clever pattern.
 *
 * Matches "+49 …", "0049 …" and any "0…" with enough digits behind it, with
 * spaces, slashes, dots, dashes and brackets allowed as separators because
 * every single one of those shows up in real adverts.
 */
const PHONE_CANDIDATE = /(?:\+\s?49|00\s?49|\(?0\)?)[\d\s./()-]{7,22}\d/g;

/**
 * Words that mean "this number is for calling us". A number sitting next to one
 * of these wins over a bare number somewhere in the text.
 */
const PHONE_KEYWORDS =
  /(tel\.?|telefon|telefonnummer|rufnummer|handy|mobil|mobile|whatsapp|erreichbar|rückruf|ruckruf|anrufen|kontakt|phone)/i;

/** Anything that looks like a date is a date, not a number to call. */
const DATE_LIKE = /\d{1,2}\s*\.\s*\d{1,2}\s*\.\s*\d{2,4}/;

/**
 * German numbers are 10 to 13 digits including the leading zero:
 * 030 1234567 (10) up to 0176 12345678 (11) and long extensions beyond that.
 * Below 10 we are almost certainly looking at a price, a size or a date.
 */
const MIN_NATIONAL_DIGITS = 10;
const MAX_NATIONAL_DIGITS = 13;

/**
 * Reads the best phone number out of a block of text, or null.
 *
 * "Best" = the one closest after a word like "Tel." or "WhatsApp"; failing
 * that, simply the first valid one. Adverts that print two numbers almost
 * always print the important one first.
 */
export function findPhone(text: string): string | null {
  if (!text) return null;
  // Non-breaking spaces and typographic dashes are everywhere in copy-pasted
  // ad text, and neither is a separator the patterns below expect.
  const haystack = text.replace(/\u00a0/g, ' ').replace(/[\u2010-\u2015]/g, '-');

  let fallback: string | null = null;

  for (const match of haystack.matchAll(PHONE_CANDIDATE)) {
    const raw = match[0];
    if (DATE_LIKE.test(raw)) continue;

    const normalised = normalisePhone(raw);
    if (!normalised) continue;

    // 60 characters is about one line of ad text — close enough to count as
    // "this label belongs to this number", far enough to survive "Tel. und
    // WhatsApp unter der Nummer …".
    const before = haystack.slice(Math.max(0, match.index - 60), match.index);
    if (PHONE_KEYWORDS.test(before)) return normalised;

    fallback ??= normalised;
  }

  return fallback;
}

/**
 * Turns a raw match into "+49 176 12345678", or null when it is not a phone
 * number after all.
 *
 * The formatting is not cosmetic: one shape means a number can be compared
 * against another (the same landlord reposting a flat) and dropped straight
 * into a `tel:` link without the UI having to think about it.
 */
export function normalisePhone(raw: string): string | null {
  const digits = raw.replace(/[^\d+]/g, '');

  // Bring everything to the national form "0…" first, so there is one shape to
  // validate instead of three.
  let national: string;
  if (digits.startsWith('+49')) national = `0${digits.slice(3)}`;
  else if (digits.startsWith('0049')) national = `0${digits.slice(4)}`;
  else if (digits.startsWith('49') && !digits.startsWith('490')) national = `0${digits.slice(2)}`;
  else if (digits.startsWith('0')) national = digits;
  else return null;

  national = national.replace(/\D/g, '');
  if (national.length < MIN_NATIONAL_DIGITS || national.length > MAX_NATIONAL_DIGITS) return null;
  // "00…" is an international prefix we did not recognise, not a German number.
  if (national.startsWith('00')) return null;
  // Placeholders rather than numbers: 0000000000, 0111111111, 0123456789.
  if (/^0(\d)\1+$/.test(national)) return null;
  if ('01234567890123'.startsWith(national)) return null;

  const rest = national.slice(1);
  // Split after the network/area code. Mobile prefixes are three digits after
  // the zero (015x/016x/017x); everything else keeps a readable 4-digit group,
  // which is right for most cities and wrong only in the harmless way.
  const isMobile = /^1[5-7]/.test(rest);
  const codeLength = isMobile ? 3 : 4;
  return `+49 ${rest.slice(0, codeLength)} ${rest.slice(codeLength)}`;
}

/** `tel:` href for a normalised number — digits and one plus, nothing else. */
export function telHref(phone: string): string {
  return `tel:${phone.replace(/[^\d+]/g, '')}`;
}

/* ----------------------------------------------------------- email ------ */

const EMAIL_IN_TEXT = /[\w.+-]+@[\w-]+\.[\w.-]{2,}/g;

/**
 * Addresses that are never a landlord: image filenames that happen to contain
 * an @, the portal's own support desk, obvious placeholders.
 */
function isPlausibleEmail(value: string): boolean {
  const email = value.toLowerCase();
  if (!/^[\w.+-]+@[\w-]+\.[\w.-]{2,}$/.test(email)) return false;
  if (/\.(png|jpe?g|gif|webp|svg|css|js)$/.test(email)) return false;
  return !/^(no-?reply|donotreply|support|info@(sentry|google|facebook)|example|test)@|@(example|sentry|google|localhost)\./.test(
    email,
  );
}

/**
 * Reads a usable e-mail address out of text. A `mailto:` link from the markup
 * wins when there is one — it is a deliberate publication, where an address in
 * the running text might belong to anybody.
 */
export function findEmail(text: string, mailtoHref?: string | null): string | null {
  if (mailtoHref && isPlausibleEmail(mailtoHref)) return mailtoHref.toLowerCase();
  for (const match of (text ?? '').matchAll(EMAIL_IN_TEXT)) {
    // "…an wohnung@gmx.de." — the full stop ends the sentence, not the address.
    const candidate = match[0].replace(/[.,;:)\]]+$/, '');
    if (isPlausibleEmail(candidate)) return candidate.toLowerCase();
  }
  return null;
}

/* ------------------------------------------------------------ name ------ */

/**
 * One capitalised name word, hyphenated surnames included: "Weber",
 * "Schmidt-Weber", "Özdemir".
 */
const NAME_WORD = '[A-ZÄÖÜ][a-zäöüß]+(?:-[A-ZÄÖÜ][a-zäöüß]+)*';

/** An optional academic title, which German adverts do print: "Herr Dr. Klein". */
const TITLE = '(?:(?:Dr|Prof|Dipl)\\.-?\\s*)?';

/**
 * "Ansprechpartner: Herr Thomas Weber", "Kontakt Frau Schmidt-Weber".
 *
 * With an explicit label in front, a second capitalised word is taken as part
 * of the name — that is the first-name-plus-surname case.
 */
const NAMED_CONTACT = new RegExp(
  `(?:ansprechpartner(?:in)?|kontaktperson|kontakt|vermieter(?:in)?|verwaltung)\\s*[:\\-–]?\\s*` +
    `((?:herr|frau)\\s+${TITLE}${NAME_WORD}(?:\\s+${NAME_WORD})?)`,
  'i',
);

/**
 * A bare "Herr Müller" anywhere in the text, as a second-best.
 *
 * One word only here: without a label there is nothing to say whether the next
 * capitalised word is a surname or the start of the next sentence, and
 * "Herr Weber. Bitte" is not somebody's name.
 */
const SALUTATION = new RegExp(`\\b((?:herr|frau)\\s+${TITLE}${NAME_WORD})`, 'i');

/**
 * The name of the person to ask for. Only taken when the ad says it plainly —
 * anything cleverer produces "Sehr Geehrte" as a landlord's name.
 */
export function findContactName(text: string): string | null {
  if (!text) return null;
  const named = text.match(NAMED_CONTACT)?.[1] ?? text.match(SALUTATION)?.[1] ?? null;
  if (!named) return null;
  const cleaned = named.replace(/\s+/g, ' ').trim();
  return cleaned.length > 3 && cleaned.length <= 60 ? cleaned : null;
}

/* ---------------------------------------------------------- all three --- */

/**
 * One pass over an advert's text for every way of reaching the landlord.
 * `mailtoHref` is the address from the page's markup, when the caller has it.
 */
export function findContact(text: string, options?: { mailtoHref?: string | null }): ContactDetails {
  return {
    phone: findPhone(text),
    email: findEmail(text, options?.mailtoHref),
    name: findContactName(text),
  };
}

/**
 * Does this advert give us a way in that is not the portal's own form?
 * Drives the "Kontakt vorhanden" badge on the results list.
 */
export function hasDirectContact(contact: { phone?: string | null; email?: string | null }): boolean {
  return !!(contact.phone || contact.email);
}
