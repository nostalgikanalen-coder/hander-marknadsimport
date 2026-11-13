import { createHash } from 'node:crypto';
import ical from 'node-ical';

const sourceUrl = 'https://www.vitahasten.se/vitahasten_alag/kalender';

export function parseVitaHomeGames(content, now = new Date()) {
  if (!content.startsWith('BEGIN:VCALENDAR') || !/X-WR-CALNAME[^\n]*Vita Hästen/i.test(content)) {
    throw new Error('Vita Hästens kalender kunde inte verifieras.');
  }
  const limit = +now + 90 * 86400000;
  return Object.values(ical.sync.parseICS(content)).flatMap(event => {
    const title = /^Match:\s*(Vita Hästen\s*[-–]\s*.+?)(?:\s*\([^)]*\))?\s*\/\//i.exec(event.summary ?? '')?.[1];
    if (event.type !== 'VEVENT' || !event.uid || !title || event.status === 'CANCELLED'
      || !Number.isFinite(+event.start) || event.datetype === 'date' || event.start < now || +event.start >= limit
      || String(event.location ?? '').trim().toLowerCase() !== 'himmelstalundshallen') return [];
    return [{
      id:'vita-hasten-'+createHash('sha256').update(event.uid).digest('hex').slice(0,32),
      title:'Hockey: '+title, startsAt:event.start, municipality:'Norrköping',
      venueName:'Himmelstalundshallen', category:'sport', source:'vita-hasten',sourceUrl
    }];
  });
}

export async function upcomingVitaHomeGames(now = new Date()) {
  const response = await fetch('https://cal.svenskalag.se/2078',{signal:AbortSignal.timeout(15000)});
  if (!response.ok) throw new Error('Vita Hästen svarade med HTTP '+response.status);
  return parseVitaHomeGames(await response.text(),now);
}
