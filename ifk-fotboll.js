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

const matchClock = new Intl.DateTimeFormat('sv-SE',{
  timeZone:'Europe/Stockholm',hour:'2-digit',minute:'2-digit',hourCycle:'h23'
});
const baseTitle = title => title.replace(/ \(Damer\)$| \(Herrar\)$/i,'');
const clean = value => value.replace(/&amp;/g,'&').replace(/&ndash;|&#8211;/g,'–').replace(/&nbsp;/g,' ').trim();

export function addTeamLabels(matches, html) {
  const labels = new Map();
  const key = (title, day, month, time) => [normalize(baseTitle(title)),Number(day),Number(month),time].join('|');
  for (const [,title,day,month,time,team] of html.matchAll(/<h3 class="post-title">([^<]+)<\/h3>\s*<location>[^<]+<\/location>\s*\|\s*<time>(\d{1,2})\/(\d{1,2})\s+(\d{2}:\d{2})<\/time>\s*<div class="type-lag">[^<|]*\|\s*(Damer|Herrar)\s*<\/div>/gi)) {
    const identity = key(clean(title),day,month,time);
    const label = /^damer$/i.test(team) ? 'Damer' : 'Herrar';
    labels.set(identity,labels.has(identity) && labels.get(identity) !== label ? null : label);
  }
  return matches.map(match => {
    const [,month,day] = localDay.format(match.startsAt).split('-');
    const team = labels.get(key(match.title,day,month,matchClock.format(match.startsAt)));
    return team ? {...match,title:match.title+' ('+team+')',team} : match;
  });
}

export async function upcomingIfkMatches(now = new Date(),request = fetch) {
  const response = await request(feed,{signal:AbortSignal.timeout(12000)});
  if (!response.ok) throw new Error('IFK svarade med HTTP '+response.status);
  const matches = parseHomeMatches(await response.text(),now);
  if (!matches.length) return matches;
  try {
    const page = await request(sourceUrl,{signal:AbortSignal.timeout(12000)});
    if (!page.ok) throw new Error('HTTP '+page.status);
    return addTeamLabels(matches,await page.text());
  } catch (error) {
    console.warn('IFK: lag kunde inte läsas från matchlistan:',error.message);
    return matches;
  }
}

export function matchIfkDuplicates(matches,visit) {
  const key = item=>[normalize(baseTitle(item.title)),item.startsAt.toISOString()].join('|');
  const known = new Map(matches.map(item=>[key(item),item.id]));
  const duplicates = new Map();
  for (const item of visit) {
    if (item.municipality !== 'Norrköping' || !isHomeVenue(item.venueName)) continue;
    const match = known.get(key(item));
    if (match) duplicates.set(item.id,match);
  }
  return duplicates;
}
