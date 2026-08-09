/**
 * Outbound fetch for URLs that came from user input.
 *
 * The liveness checker visits addresses colleagues pasted in, so it must not
 * become an SSRF hole: no file:// or gopher://, no localhost, no RFC1918 or
 * link-local targets, no redirect chain that sneaks into them.
 */

import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

export class BlockedUrlError extends Error {}

const BLOCKED_HOSTNAMES = new Set(['localhost', 'metadata.google.internal', 'metadata']);

function isPrivateIPv4(ip: string): boolean {
  const p = ip.split('.').map(Number);
  if (p.length !== 4 || p.some((n) => Number.isNaN(n))) return true;
  const [a, b] = p;
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 0) return true;
  if (a === 169 && b === 254) return true; // link-local / cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a >= 224) return true; // multicast / reserved
  return false;
}

function isPrivateIPv6(ip: string): boolean {
  const lower = ip.toLowerCase().replace(/^\[|\]$/g, '');
  if (lower === '::1' || lower === '::') return true;
  if (lower.startsWith('fe80')) return true; // link-local
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true; // unique local
  if (lower.startsWith('::ffff:')) return isPrivateIPv4(lower.slice(7));
  return false;
}

/** Throws BlockedUrlError when the URL must not be fetched. */
export async function assertPublicUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new BlockedUrlError('Keine gültige URL');
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new BlockedUrlError(`Protokoll ${url.protocol} ist nicht erlaubt`);
  }

  const host = url.hostname.toLowerCase();
  if (BLOCKED_HOSTNAMES.has(host) || host.endsWith('.localhost') || host.endsWith('.internal')) {
    throw new BlockedUrlError('Interner Host');
  }

  // Literal IPs are checked directly; names are resolved first so a hostname
  // pointing at 127.0.0.1 is caught too.
  const literal = isIP(host);
  const addresses =
    literal > 0
      ? [{ address: host, family: literal }]
      : await lookup(host, { all: true }).catch(() => {
          throw new BlockedUrlError('DNS-Auflösung fehlgeschlagen');
        });

  for (const a of addresses) {
    const blocked = a.family === 6 ? isPrivateIPv6(a.address) : isPrivateIPv4(a.address);
    if (blocked) throw new BlockedUrlError('Zieladresse liegt im internen Netz');
  }

  return url;
}

export interface SafeFetchResult {
  status: number | null;
  finalUrl: string | null;
  bodySnippet: string | null;
  networkError: string | null;
}

/**
 * GET a public URL with a timeout, a small body cap and manual redirect
 * handling so every hop is validated.
 */
export async function safeFetch(
  raw: string,
  options: { timeoutMs?: number; maxRedirects?: number; maxBytes?: number; userAgent?: string } = {},
): Promise<SafeFetchResult> {
  const timeoutMs = options.timeoutMs ?? 12_000;
  const maxRedirects = options.maxRedirects ?? 4;
  const maxBytes = options.maxBytes ?? 64 * 1024;
  const userAgent =
    options.userAgent ??
    'FreseWohnung-LinkCheck/1.0 (+internes Werkzeug; prüft nur, ob eine bekannte Anzeige noch erreichbar ist)';

  let current = raw;

  for (let hop = 0; hop <= maxRedirects; hop++) {
    let url: URL;
    try {
      url = await assertPublicUrl(current);
    } catch (err) {
      return {
        status: null,
        finalUrl: null,
        bodySnippet: null,
        networkError: (err as Error).message,
      };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url.toString(), {
        method: 'GET',
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          'user-agent': userAgent,
          accept: 'text/html,application/xhtml+xml',
          'accept-language': 'de-DE,de;q=0.9',
        },
      });

      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get('location');
        if (!location) {
          return { status: res.status, finalUrl: url.toString(), bodySnippet: null, networkError: null };
        }
        current = new URL(location, url).toString();
        continue;
      }

      // Read a capped slice; we only need enough to spot a "gone" notice.
      let snippet: string | null = null;
      try {
        const reader = res.body?.getReader();
        if (reader) {
          const chunks: Uint8Array[] = [];
          let total = 0;
          while (total < maxBytes) {
            const { done, value } = await reader.read();
            if (done) break;
            chunks.push(value);
            total += value.length;
          }
          await reader.cancel().catch(() => undefined);
          snippet = new TextDecoder('utf-8', { fatal: false })
            .decode(concat(chunks, Math.min(total, maxBytes)))
            .slice(0, maxBytes);
        }
      } catch {
        snippet = null;
      }

      return { status: res.status, finalUrl: url.toString(), bodySnippet: snippet, networkError: null };
    } catch (err) {
      const msg = (err as Error).name === 'AbortError' ? 'Zeitüberschreitung' : (err as Error).message;
      return { status: null, finalUrl: null, bodySnippet: null, networkError: msg.slice(0, 120) };
    } finally {
      clearTimeout(timer);
    }
  }

  return { status: null, finalUrl: null, bodySnippet: null, networkError: 'Zu viele Weiterleitungen' };
}

function concat(chunks: Uint8Array[], total: number): Uint8Array {
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    if (offset >= total) break;
    const take = Math.min(c.length, total - offset);
    out.set(c.subarray(0, take), offset);
    offset += take;
  }
  return out;
}
