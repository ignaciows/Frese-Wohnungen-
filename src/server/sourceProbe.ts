/**
 * Runs the source probe against a real website.
 *
 * Kept small on purpose: all the judgement lives in `domain/discovery/probe`,
 * which is pure and testable. This part only decides which URLs to try and in
 * what order, and it does that through the same polite crawler as everything
 * else — robots.txt included, because probing a site is still visiting it.
 */

import { Crawler } from './crawler';
import {
  COMMON_FEED_PATHS,
  COMMON_SITEMAP_PATHS,
  buildCandidates,
  declaredFeeds,
  describeReport,
  feedItemCount,
  type ProbeReport,
} from '@/domain/discovery/probe';

export async function probeSource(
  rawUrl: string,
  options: { maxRequests?: number; perHostDelayMs?: number } = {},
): Promise<ProbeReport> {
  const crawler = new Crawler({
    // A probe is a handful of requests to one host; a shorter delay than a
    // full sweep keeps it interactive without being rude.
    perHostDelayMs: options.perHostDelayMs ?? 1500,
    maxRequests: options.maxRequests ?? 12,
  });

  const report: ProbeReport = {
    url: rawUrl,
    reachable: false,
    blocked: false,
    robotsAllowed: true,
    note: '',
    candidates: [],
  };

  const searchPage = await crawler.fetchPage(rawUrl);

  if (searchPage.error?.includes('robots.txt')) {
    report.robotsAllowed = false;
    report.note = describeReport(report);
    return report;
  }
  if (searchPage.blocked) {
    report.blocked = true;
    report.note = describeReport(report);
    return report;
  }
  if (searchPage.error || !searchPage.body) {
    report.note = searchPage.error ?? 'Keine Antwort';
    report.note = describeReport(report);
    return report;
  }

  report.reachable = true;

  // 1. Feeds the page declares itself — the most reliable signal there is.
  const feedUrls = declaredFeeds(searchPage);

  // 2. Otherwise try the handful of conventional locations. Stop at the first
  //    hit: a site with a working feed does not need five more requests.
  if (feedUrls.length === 0) {
    const origin = originOf(searchPage.finalUrl ?? rawUrl);
    if (origin) {
      for (const path of COMMON_FEED_PATHS) {
        if (crawler.budgetLeft <= 2) break;
        const candidate = await crawler.fetchPage(origin + path);
        if (feedItemCount(candidate) > 0) {
          feedUrls.push(candidate.finalUrl ?? candidate.url);
          break;
        }
      }
    }
  }

  const feedPages = [];
  for (const url of feedUrls.slice(0, 3)) {
    if (crawler.budgetLeft <= 1) break;
    feedPages.push(await crawler.fetchPage(url));
  }

  // 3. A sitemap, only when nothing better turned up — it is the weakest
  //    signal and the largest download.
  let sitemapPage = null;
  const hasStrongCandidate =
    feedPages.some((p) => feedItemCount(p) > 0) || (searchPage.body?.includes('application/ld+json') ?? false);
  if (!hasStrongCandidate) {
    const origin = originOf(searchPage.finalUrl ?? rawUrl);
    if (origin) {
      for (const path of COMMON_SITEMAP_PATHS) {
        if (crawler.budgetLeft <= 0) break;
        const candidate = await crawler.fetchPage(origin + path);
        if (candidate.body?.includes('<loc>')) {
          sitemapPage = candidate;
          break;
        }
      }
    }
  }

  report.candidates = buildCandidates({
    searchUrl: searchPage.finalUrl ?? rawUrl,
    searchPage,
    feedPages,
    sitemapPage,
  });
  report.note = describeReport(report);
  return report;
}

function originOf(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}
