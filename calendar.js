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

export const marketWindowMs = 90 * 86400000;

export function upcomingMarkets(content, now = new Date()) {
  if (!/^BEGIN:VCALENDAR\r?\n/.test(content) || !/END:VCALENDAR\s*$/.test(content)) {
    throw new Error('Marknadskalendern returnerade inte giltig iCal.');
  }
  const until = new Date(now.getTime() + marketWindowMs);
  const events = Object.values(ical.sync.parseICS(content)).filter(event => event.type === 'VEVENT');
  if (!events.length) throw new Error('Marknadskalendern saknar läsbara evenemang.');
  const markets = [];
  for (const event of events) {
    if (event.status === 'CANCELLED' || event.datetype === 'date'
      || event.recurrenceid || !event.uid || !event.start) continue;
    const instances = event.rrule
      ? ical.expandRecurringEvent(event,{from:now,to:until})
      : [{start:event.start,event}];
    for (const instance of instances) {
      const detail = instance.event;
      if (detail.status === 'CANCELLED' || instance.isFullDay
        || instance.start < now || instance.start >= until) continue;
      const name = String(instance.summary || event.summary || '');
      const place = String(detail.location ?? event.location ?? '');
      const area = areas.find(({pattern}) => pattern.test(place) || pattern.test(name));
      if (!area || !/loppis|fyndmässa|marknad/i.test(name)) continue;
      const venueName = place.split(',')[0].trim() || (name.match(/bergs slussar|mirum galleria|holmentorget/i)?.[0] ?? '');
      const type = /julloppis/i.test(name) ? 'Julloppis'
        : /bakluckeloppis/i.test(name) ? 'Bakluckeloppis'
        : /loppis|fyndmässa/i.test(name) ? 'Loppis' : 'Marknad';
      const recurrence = detail.recurrenceid || instance.start;
      const key = event.rrule ? event.uid + '|' + recurrence.toISOString() : event.uid;
      markets.push({
        id:'ostgotamarknader-' + createHash('sha256').update(key).digest('hex').slice(0,32),
        title:type + ' i ' + area.municipality,
        startsAt:instance.start,
        municipality:area.municipality,
        venueName,
        category:'loppis',
        source:'ostgotamarknader',
        sourceUrl,
        recurringMarket:Boolean(event.rrule)
      });
    }
  }
  return markets.sort((a,b)=>a.startsAt-b.startsAt);
}
