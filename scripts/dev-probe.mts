/**
 * Development helper: probe a list of candidate sources and print, for each,
 * whether it can be read automatically and how.
 *
 *   npx tsx scripts/dev-probe.mts                # the built-in survey list
 *   npx tsx scripts/dev-probe.mts <url> [<url>]  # specific sites
 */
import { probeSource } from '../src/server/sourceProbe';

const SURVEY = [
  // --- große Marktplätze -------------------------------------------------
  'https://www.kleinanzeigen.de/s-wohnung-mieten/heilbronn/c203l9228',
  'https://www.wg-gesucht.de/wohnungen-in-Heilbronn-Heilbronn.171.2.1.0.html',
  'https://www.immobilienscout24.de/Suche/de/baden-wuerttemberg/heilbronn/wohnung-mieten',
  'https://www.immowelt.de/liste/heilbronn/wohnungen/mieten',
  'https://www.immonet.de/immobiliensuche/sel.do?suchart=2&city=Heilbronn',
  'https://www.immobilien.de/Heilbronn/Wohnung/mieten',
  'https://www.wohnungsboerse.net/mietwohnungen/Heilbronn',
  'https://www.immobilo.de/mietwohnungen/heilbronn',
  'https://www.ohne-makler.net/immobilie/kategorie/wohnung-mieten/',
  'https://www.quoka.de/immobilien/mietwohnungen/',
  'https://www.markt.de/heilbronn/immobilien/mietwohnungen/',
  'https://www.kalaydo.de/immobilienmarkt/wohnung-mieten/',
  'https://www.immosuchmaschine.de/suche/heilbronn/mietwohnungen',
  'https://immobilien.meinestadt.de/heilbronn/wohnung-mieten',

  // --- möbliert / temporär ----------------------------------------------
  'https://wunderflats.com/de/moeblierte-wohnungen/heilbronn',
  'https://housinganywhere.com/s/Heilbronn--Germany',
  'https://www.spotahome.com/de/mieten/heilbronn',
  'https://www.homelike.com/de/heilbronn',
  'https://www.monteurzimmer.de/heilbronn/',
  'https://www.hc24.de/moeblierte-wohnungen/heilbronn',
  'https://www.mrlodge.de/moeblierte-wohnungen/',
  'https://www.city-wohnen.de/',
  'https://www.nestpick.com/de/heilbronn/',

  // --- institutionelle Vermieter ----------------------------------------
  'https://www.vonovia.de/de-de/immobiliensuche',
  'https://immobilien.leg-wohnen.de/wohnungssuche/',
  'https://www.tag-wohnen.de/wohnungssuche/',
  'https://www.vivawest.de/immobiliensuche',
  'https://www.deutsche-wohnen.com/immobilien-finden',
  'https://www.grandcityproperty.de/wohnungssuche',
  'https://www.adler-group.com/de/wohnen',
  'https://www.saga.hamburg/immobiliensuche',
  'https://www.degewo.de/immosuche',
  'https://www.gewobag.de/fuer-mieter-und-mietinteressenten/mietangebote/',
  'https://www.howoge.de/wohnungssuche.html',
  'https://www.stadtundland.de/wohnungssuche',
  'https://www.wbm.de/wohnungen-berlin/',
  'https://www.gewofag.de/wohnungsangebote',
  'https://www.abg-fh.com/vermietung/',
  'https://www.swsg.de/wohnungsangebote',
  'https://inberlinwohnen.de/wohnungsfinder/',

  // --- regional Heilbronn / Baden-Württemberg ---------------------------
  'https://www.stadtsiedlung.de/wohnungsangebote/',
  'https://www.gwg-heilbronn.de/wohnungsangebote/',
  'https://www.wohnraum-bw.de/',
  'https://immobilienmarkt.stimme.de/immobilien/mietwohnungen',

  // --- Genossenschaften (Stichprobe) ------------------------------------
  'https://www.wohnungsbaugenossenschaften.de/',
  'https://www.gdw.de/',
];

const targets = process.argv.slice(2).length > 0 ? process.argv.slice(2) : SURVEY;

const rows: Array<{ url: string; verdict: string; adapter: string; note: string }> = [];

for (const url of targets) {
  let host = url;
  try {
    host = new URL(url).host.replace(/^www\./, '');
  } catch {
    /* keep the raw string */
  }
  try {
    const report = await probeSource(url, { maxRequests: 8, perHostDelayMs: 1200 });
    const best = report.candidates[0];
    const verdict = !report.robotsAllowed
      ? 'ROBOTS'
      : report.blocked
        ? 'BLOCKED'
        : !report.reachable
          ? 'UNREACHABLE'
          : best
            ? 'OK'
            : 'NO-PATTERN';
    rows.push({
      url: host,
      verdict,
      adapter: best ? `${best.adapter}(${best.confidence})` : '—',
      note: report.note.slice(0, 90),
    });
    console.log(`${verdict.padEnd(11)} ${host.padEnd(34)} ${(best ? best.adapter : '—').padEnd(9)} ${report.note.slice(0, 80)}`);
  } catch (err) {
    rows.push({ url: host, verdict: 'ERROR', adapter: '—', note: (err as Error).message });
    console.log(`${'ERROR'.padEnd(11)} ${host.padEnd(34)} ${'—'.padEnd(9)} ${(err as Error).message.slice(0, 80)}`);
  }
}

console.log('\n=== Zusammenfassung ===');
const byVerdict = new Map<string, number>();
for (const r of rows) byVerdict.set(r.verdict, (byVerdict.get(r.verdict) ?? 0) + 1);
for (const [verdict, count] of [...byVerdict.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`${verdict.padEnd(12)} ${count}`);
}
console.log('\nverwertbar:');
for (const r of rows.filter((r) => r.verdict === 'OK')) {
  console.log(`  ${r.url.padEnd(34)} ${r.adapter}`);
}
