/**
 * URL normalisation for duplicate detection. We do not want two colleagues to
 * contact the same landlord because one URL had `?utm_source=mail` and the
 * other did not.
 *
 * Strategy: lower-case host, strip "www." and "m." prefixes on the same
 * portal, drop tracking parameters, drop fragments. Trailing slashes are
 * removed on paths that are not just "/".
 */

const TRACKING_PARAM_PREFIXES = ['utm_', 'gclid', 'fbclid', 'ref_', 'mc_'];
const TRACKING_PARAMS = new Set([
  'ref',
  'source',
  'origin',
  'via',
  'campaign',
  'trackingId',
  'referrer',
  '__cf_chl_tk',
]);

const MOBILE_HOST_PREFIXES = ['m.', 'mobile.'];

export function normaliseUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return raw.trim();
  }

  let host = url.hostname.toLowerCase();
  if (host.startsWith('www.')) host = host.slice(4);
  for (const prefix of MOBILE_HOST_PREFIXES) {
    if (host.startsWith(prefix)) host = host.slice(prefix.length);
  }
  url.hostname = host;
  url.protocol = 'https:';

  // Drop tracking + hash noise.
  const drop: string[] = [];
  url.searchParams.forEach((_v, k) => {
    const key = k.toLowerCase();
    if (TRACKING_PARAMS.has(key)) drop.push(k);
    for (const p of TRACKING_PARAM_PREFIXES) {
      if (key.startsWith(p)) drop.push(k);
    }
  });
  for (const k of drop) url.searchParams.delete(k);

  url.hash = '';

  // Sort remaining query params for stable canonical form.
  const sortedParams = [...url.searchParams.entries()].sort(([a], [b]) => a.localeCompare(b));
  url.search = '';
  for (const [k, v] of sortedParams) url.searchParams.append(k, v);

  let out = url.toString();
  // Remove trailing slash if the pathname is more than "/".
  if (out.endsWith('/') && url.pathname !== '/') {
    out = out.slice(0, -1);
  }
  return out;
}

/**
 * Best-effort extraction of the portal-side listing id from a canonical URL.
 * Only used as a hint; a null return is not an error.
 */
export function extractSourceListingId(canonicalUrl: string): string | null {
  try {
    const url = new URL(canonicalUrl);
    const host = url.hostname;

    // ImmoScout24: /expose/123456789
    if (host.includes('immobilienscout24.de') || host.includes('immoscout24.de')) {
      const m = url.pathname.match(/\/expose\/(\d+)/);
      if (m) return `is24:${m[1]}`;
    }
    // Immowelt / Immonet: /expose/xyz or /classified-ad/...
    if (host.includes('immowelt.de') || host.includes('immonet.de')) {
      const m = url.pathname.match(/\/expose\/([a-z0-9-]+)/i);
      if (m) return `immowelt:${m[1]}`;
    }
    // Kleinanzeigen: last path segment is usually /s-anzeige/.../<id>
    if (host.includes('kleinanzeigen.de') || host.includes('ebay-kleinanzeigen.de')) {
      const parts = url.pathname.split('/').filter(Boolean);
      const last = parts[parts.length - 1];
      if (last && /\d/.test(last)) return `kleinanzeigen:${last}`;
    }
    // Generic fallback: last numeric-looking segment.
    const parts = url.pathname.split('/').filter(Boolean);
    for (let i = parts.length - 1; i >= 0; i--) {
      if (/^\d{5,}$/.test(parts[i])) return `${host}:${parts[i]}`;
    }
    return null;
  } catch {
    return null;
  }
}
