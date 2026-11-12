const calendar = 'https://www.arbis.se/kalender';
const zone = 'Europe/Stockholm';
const localDay = new Intl.DateTimeFormat('sv-SE',{timeZone:zone});
const localTime = new Intl.DateTimeFormat('sv-SE',{timeZone:zone,dateStyle:'short',timeStyle:'short',hourCycle:'h23'});
const weekdays = 'söndag måndag tisdag onsdag torsdag fredag lördag'.split(' ');
const months = 'januari februari mars april maj juni juli augusti september oktober november december'.split(' ');

function plain(html) {
  return String(html ?? '').replace(/<[^>]+>/g,' ').replace(/&amp;/g,'&')
    .replace(/&nbsp;|&#160;/g,' ').replace(/&#8211;/g,'–').replace(/\s+/g,' ').trim();
}
function concertDay(label, expiry) {
  const parts = label.toLowerCase().match(/^([a-zåäö]+)\s+(\d{1,2})\s+([a-zåäö]+)/);
  if (!parts || !/^20\d{2}-\d{2}-\d{2}$/.test(expiry)) return '';
  const [,dayName,day,monthName] = parts;
  const month = months.indexOf(monthName);
  if (month < 0 || !weekdays.includes(dayName)) return '';
  const end = new Date(expiry+'T12:00:00Z');
  for (const year of [end.getUTCFullYear(),end.getUTCFullYear()-1]) {
    const date = new Date(Date.UTC(year,month,Number(day),12));
    const distance = (end-date)/86400000;
    if (date.getUTCMonth() === month && weekdays[date.getUTCDay()] === dayName && distance >= 0 && distance <= 7) return date.toISOString().slice(0,10);
  }
  return '';
}
export function arbisCalendarCards(html) {
  const cards = new Map();
  for (const part of html.split('class="customblog__card-title"').slice(1)) {
    const title = plain(part.match(/^>([\s\S]*?)<\/span>/)?.[1]);
    const label = plain(part.match(/class="customblog__card-text">([\s\S]*?)<\/span>/)?.[1]);
    const path = part.match(/href="((?:\/)?kalender\/[a-z0-9-]+)"[^>]*class="readmore-button/i)?.[1];
    const expiry = plain(part.match(/class="eventblog__publish-date-filter">([\s\S]*?)<\/span>/)?.[1]);
    const day = concertDay(label,expiry);
    if (!title || !day || !path || /\b(inställt|inställd|flyttad|uppskjutet)\b/i.test(title)) continue;
    const slug = path.split('/').at(-1);
    cards.set(slug+'|'+day,{slug,title,day,url:calendar+'/'+slug});
  }
  return [...cards.values()];
}
export function concertFromPage(card, html) {
  const start = plain(html).match(/(?:konsertstart|scenstart)\s*:\s*(\d{1,2})[:.](\d{2})\b/i);
  if (!start) return null;
  const hour = start[1].padStart(2,'0')+':'+start[2];
  const utc = Date.parse(card.day+'T'+hour+':00Z');
  const times = [1,2].map(offset=>new Date(utc-offset*3600000))
    .filter(date=>Number.isFinite(+date)&&localTime.format(date).replace(',','')===card.day+' '+hour);
  if (times.length !== 1) return null;
  return {
    id:'arbis-'+card.slug+'-'+card.day,title:card.title,startsAt:times[0],
    venueName:'Arbis',address:'Bredgatan 54',municipality:'Norrköping',
    category:'musik',source:'arbis',sourceUrl:card.url
  };
}
export async function upcomingArbisConcerts(now = new Date(), request = fetch) {
  async function read(url) {
    const response = await request(url,{signal:AbortSignal.timeout(12000)});
    if (!response.ok) throw new Error('Arbis svarade med HTTP '+response.status);
    return response.text();
  }
  const cards = arbisCalendarCards(await read(calendar));
  if (!cards.length) throw new Error('Arbis kalenderformat kunde inte läsas.');
  const today = localDay.format(now);
  const limit = localDay.format(new Date(now.getTime()+90*86400000));
  const upcoming = cards.filter(card=>card.day>=today && card.day<=limit);
  const concerts = [];
  let failures = 0;
  for (let offset=0;offset<upcoming.length;offset+=5) {
    const group = await Promise.allSettled(upcoming.slice(offset,offset+5).map(async card=>concertFromPage(card,await read(card.url))));
    for (const result of group) {
      if (result.status === 'rejected') failures++;
      else if (result.value) concerts.push(result.value);
    }
  }
  if (upcoming.length && failures === upcoming.length) throw new Error('Arbis evenemangssidor kunde inte läsas.');
  if (failures) console.warn('Arbis: sidor som inte kunde läsas:',failures);
  return concerts;
}
export function matchArbisDuplicates(arbis, visit) {
  const titleKey = title=>String(title ?? '').normalize('NFC').toLocaleLowerCase('sv').replace(/[^\p{L}\p{N}]+/gu,' ').trim();
  const groups = new Map();
  for (const item of arbis) {
    const key = titleKey(item.title)+'|'+localDay.format(item.startsAt);
    groups.set(key,groups.has(key) ? null : item.id);
  }
  const duplicates = new Map();
  for (const item of visit) {
    if (!/^arbis(?:\s|$)/i.test(item.venueName ?? '') || item.municipality !== 'Norrköping') continue;
    const match = groups.get(titleKey(item.title)+'|'+localDay.format(item.startsAt));
    if (match) duplicates.set(item.id,match);
  }
  return duplicates;
}
