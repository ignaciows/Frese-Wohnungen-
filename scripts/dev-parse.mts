/**
 * Development helper: fetch one URL through the real crawler and show what the
 * adapter makes of it. `npx tsx scripts/dev-parse.mts <adapter> <url>`
 */
import { Crawler } from '../src/server/crawler';
import { getAdapter } from '../src/domain/discovery/registry';

const [adapterKey, url] = process.argv.slice(2);
const adapter = getAdapter(adapterKey);
if (!adapter) throw new Error(`unknown adapter ${adapterKey}`);

const crawler = new Crawler({ perHostDelayMs: 1000, maxRequests: 5 });
const page = await crawler.fetchPage(url);
console.log('status', page.status, 'blocked', page.blocked, 'error', page.error, 'bytes', page.body?.length ?? 0);
if (page.body) {
  console.log('marker hits:', (page.body.match(/<article class="aditem"/g) ?? []).length);
}

const items = adapter.parse(page, {});
console.log('parsed', items.length);
for (const i of items.slice(0, 6)) {
  console.log('-', i.title.slice(0, 50), '|', i.locationPostal, i.locationCity, '|', JSON.stringify(i.structured), '|', i.url.slice(0, 70));
}
