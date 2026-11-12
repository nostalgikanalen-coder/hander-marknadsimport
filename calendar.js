import { createHash } from 'node:crypto';
import ical from 'node-ical';

const sourceUrl = 'https://www.ostgotamarknader.se/marknadsdatum';
const calendarId = '86qhvpelhar13ommv6oe5a18g8@group.calendar.google.com';
const feed = 'https://calendar.google.com/calendar/ical/' + encodeURIComponent(calendarId) + '/public/basic.ics';
const areas = [
  {pattern:/norrköping|mirum galleria|holmentorget/i, municipality:'Norrköping'},
  {pattern:/linköping|bergs slussar/i, municipality:'Linköping'}
];

export async function readFeed() {
  const response = await fetch(feed,{signal:AbortSignal.timeout(20000)});
  if (!response.ok) throw new Error('Marknadskalendern svarade med HTTP ' + response.status);
  return response.text();
}

export function upcomingMarkets(content, now = new Date()) {
  if (!/^BEGIN:VCALENDAR\r?\n/.test(content) || !/END:VCALENDAR\s*$/.test(content)) {
    throw new Error('Marknadskalendern returnerade inte giltig iCal.');
  }
  const until = new Date(now.getTime() + 90 * 86400000);
  const markets = [];
  for (const event of Object.values(ical.sync.parseICS(content))) {
    if (event.type !== 'VEVENT' || event.status === 'CANCELLED' || event.datetype === 'date'
      || event.rrule || event.recurrenceid || !event.uid || !event.start) continue;
    const name = String(event.summary ?? '');
    const place = String(event.location ?? '');
    const area = areas.find(({pattern}) => pattern.test(place) || pattern.test(name));
    if (!area || !/loppis|fyndmässa|marknad/i.test(name) || event.start < now || event.start >= until) continue;
    const venueName = place.split(',')[0].trim() || (name.match(/bergs slussar|mirum galleria|holmentorget/i)?.[0] ?? '');
    const type = /julloppis/i.test(name) ? 'Julloppis'
      : /bakluckeloppis/i.test(name) ? 'Bakluckeloppis'
      : /loppis|fyndmässa/i.test(name) ? 'Loppis' : 'Marknad';
    markets.push({
      id:'ostgotamarknader-' + createHash('sha256').update(event.uid).digest('hex').slice(0,32),
      title:type + ' i ' + area.municipality,
      startsAt:event.start,
      municipality:area.municipality,
      venueName,
      category:'loppis',
      source:'ostgotamarknader',
      sourceUrl
    });
  }
  return markets.sort((a,b)=>a.startsAt-b.startsAt);
}
