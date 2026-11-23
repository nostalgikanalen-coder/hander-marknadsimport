import {rememberPricePage} from './event-prices.js';
import { setTimeout as pause } from 'node:timers/promises';

const transientStatuses = new Set([408, 429, 500, 502, 503, 504]);
function describe(error, seen = new Set()) {
  if (!error || seen.has(error)) return '';
  seen.add(error);
  const details = [error.code, error.message];
  if (error.cause) details.push(describe(error.cause, seen));
  for (const child of error.errors ?? []) details.push(describe(child, seen));
  return [...new Set(details.filter(Boolean))].join(' · ');
}

export async function fetchCalendar(url, request = fetch, options = {}) {
  const wait = options.wait ?? pause;
  const attempts = 3;
  for (let attempt = 0; attempt < attempts; attempt++) {
    let retryDelay = 1000 * 2 ** attempt;
    try {
      const response = await request(url, {
        signal: AbortSignal.timeout(20000),
        headers: {
          'User-Agent': 'UtIOst-EventImporter/1.0 (+https://utiost.se)',
          'Accept': 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'sv-SE,sv;q=0.9,en;q=0.5'
        }
      });
      if (response.ok) { const html=await response.text(); rememberPricePage(url,html); return html; }
      // Release unsuccessful responses before retrying.
      await response.body?.cancel();
      const error = Object.assign(new Error('HTTP ' + response.status), {
        retryable: transientStatuses.has(response.status)
      });
      const retryAfter = response.headers?.get('retry-after');
      if (retryAfter) {
        const seconds = Number(retryAfter);
        const duration = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(retryAfter) - Date.now();
        // Avoid retrying earlier than requested; leave a long wait to the next scheduled run.
        if (Number.isFinite(duration) && duration > 15000) error.retryable = false;
        else if (Number.isFinite(duration)) retryDelay = Math.max(retryDelay, duration);
      }
      throw error;
    } catch (error) {
      if (attempt === attempts - 1 || error.retryable === false) {
        const parsed = new URL(url);
        throw new Error(parsed.hostname + ' ' + parsed.pathname + ': ' + describe(error)
          + ' (efter ' + (attempt + 1) + ' försök)', { cause: error });
      }
    }
    await wait(retryDelay);
  }
}
