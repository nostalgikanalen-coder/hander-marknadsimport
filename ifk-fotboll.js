import { createHash } from 'node:crypto';
import ical from 'node-ical';

const sourceUrl = 'https://ifknorrkoping.se/nyheter/kalender/';
const feed = 'https://ifknorrkoping.se/?feed=ifk-cal-feed';
const localDay = new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Stockholm'});
export const footballWindowMs = 90 * 86400000;

function normalize(value) {
  return String(value ?? '').normalize('NFC').toLocaleLowerCase('sv')
    .replace(/[^\p{L}\p{N}]+/gu,' ').trim();
}
function isHomeVenue(value) {
  return /\b(idrottsparken|platinumcars arena|nya parken)\b/i.test(value ?? '');
}
export function parseHomeMatches(content,now = new Date()) {
  if (!/^BEGIN:VCALENDAR\r?\n/.test(content) || !/END:VCALENDAR\s*$/.test(content)
    || !/X-WR-CALNAME:IFK Norrköping/i.test(content)) throw new Error('IFK:s matchkalender kunde inte verifieras.');
  const rows = new Map();
  const collisions = new Set();
  for (const event of Object.values(ical.sync.parseICS(content))) {
    if (event.type !== 'VEVENT' || event.datetype === 'date' || event.status === 'CANCELLED'
      || !Number.isFinite(event.start?.getTime?.()) || event.start < now
      || event.start >= new Date(now.getTime()+footballWindowMs)) continue;
    const title = String(event.summary ?? '').trim();
    const teams = title.match(/^IFK Norrköping\s*[–—-]\s*(.+)$/i);
    if (!teams || !isHomeVenue(event.location)) continue;
    const key = normalize(teams[1])+'|'+localDay.format(event.start);
    const previous = rows.get(key);
    if (previous) {
      if (+previous.startsAt !== +event.start) collisions.add(key);
      continue;
    }
    const venueName = 'Idrottsparken';
    const point = event.geo && Number.isFinite(event.geo.lat) && Number.isFinite(event.geo.lon)
      ? {latitude:event.geo.lat,longitude:event.geo.lon} : {};
    rows.set(key,{
      id:'ifk-fotboll-'+createHash('sha256').update(key).digest('hex').slice(0,32),
      title,startsAt:event.start,municipality:'Norrköping',venueName,category:'sport',
      source:'ifk-fotboll',sourceUrl,...point
    });
  }
  if (collisions.size) console.warn('IFK: flera matcher mot samma lag samma dag. Osäkra matcher hoppas över:',collisions.size);
  return [...rows].filter(([key])=>!collisions.has(key)).map(([,row])=>row);
}

export async function upcomingIfkMatches(now = new Date(),request = fetch) {
  const response = await request(feed,{signal:AbortSignal.timeout(12000)});
  if (!response.ok) throw new Error('IFK svarade med HTTP '+response.status);
  return parseHomeMatches(await response.text(),now);
}

export function matchIfkDuplicates(matches,visit) {
  const key = item=>[normalize(item.title),item.startsAt.toISOString()].join('|');
  const known = new Map(matches.map(item=>[key(item),item.id]));
  const duplicates = new Map();
  for (const item of visit) {
    if (item.municipality !== 'Norrköping' || !isHomeVenue(item.venueName)) continue;
    const match = known.get(key(item));
    if (match) duplicates.set(item.id,match);
  }
  return duplicates;
}
