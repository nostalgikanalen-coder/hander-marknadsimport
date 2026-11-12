function normalize(value = '') {
  return value.toLocaleLowerCase('sv').replace(/[^\p{L}\p{N}]+/gu,' ').trim();
}

function marketKey(entry) {
  if (entry.category !== 'loppis' && !/loppis|fyndmässa|marknad/i.test(entry.title)) return '';
  const venue = normalize(entry.venueName?.split(',')[0]);
  if (!venue || !entry.municipality || !entry.startsAt) return '';
  const title = normalize(entry.title);
  const kind = title.includes('julloppis') ? 'julloppis'
    : title.includes('bakluckeloppis') ? 'bakluckeloppis'
    : title.includes('loppis') || title.includes('fyndmässa') ? 'loppis'
    : title.includes('marknad') ? 'marknad' : '';
  if (!kind) return '';
  return [entry.municipality,entry.startsAt.toISOString(),venue,kind].join('|');
}

export function matchMarketDuplicates(markets,visitEvents) {
  const marketKeys = new Map();
  for (const market of markets) {
    const key = marketKey(market);
    if (key) marketKeys.set(key,marketKeys.has(key) ? null : market);
  }
  const duplicates = new Map();
  for (const entry of visitEvents) {
    const primary = marketKeys.get(marketKey(entry));
    if (primary) duplicates.set(entry.id,primary.id);
  }
  return duplicates;
}
