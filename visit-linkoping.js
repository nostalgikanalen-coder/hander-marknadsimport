import { createHash } from 'node:crypto';
import { fetchCalendar } from './fetch-calendar.js';

const calendar = 'https://visitlinkoping.se/evenemang/';
const clock = new Intl.DateTimeFormat('sv-SE',{
  timeZone:'Europe/Stockholm',dateStyle:'short',timeStyle:'short',hourCycle:'h23'
});
const plain = html => (html ?? '').replace(/<[^>]+>/g,' ')
  .replace(/&amp;|&#0*38;/g,'&').replace(/&nbsp;/g,' ').replace(/\s+/g,' ').trim();

export function parseLinkopingEvent(html,url,now) {
  const title = plain(html.match(/<h1[^>]*class="event-title[^"]*"[^>]*>([\s\S]*?)<\/h1>/i)?.[1]);
  const details = html.slice(html.indexOf('class="event-title'),html.indexOf('class="event-title')+12000);
  const venueName = plain(details.match(/<a[^>]*class="detail-text[^"]*"[^>]*>([\s\S]*?)(?:<span|<\/a>)/i)?.[1]);
  const organizer = plain(details.match(/Arrangör:\s*([^<]+)/i)?.[1]);
  if (!title || !venueName || /inställ[dt]|uppskjut/i.test(title) || /julmarknad|jul på ekenäs|jul på lofstad|jul på löfstad|(?:ishockey|speedway|fotboll)/i.test(title)) return [];
  const times = new Set([...html.matchAll(/<input\s+id="products_occasion-(\d{4}-\d{2}-\d{2})-(\d{2})(\d{2})"/g)]
    .map(([,day,hour,minute])=>day+' '+hour+':'+minute));
  const primary = details.match(/<time datetime="(\d{4}-\d{2}-\d{2})"[^>]*>[^<]*<\/time>[\s\S]{0,1500}?<time datetime="(\d{2}:\d{2})"/);
  if (primary) times.add(primary[1]+' '+primary[2]);
  return [...times].flatMap(local=>{
    const base = Date.parse(local.replace(' ','T')+':00Z');
    const candidates = [1,2].map(offset=>new Date(base-offset*3600000))
      .filter(date=>Number.isFinite(+date) && clock.format(date).replace(',','')===local);
    if (candidates.length !== 1 || candidates[0]<now || +candidates[0]>=+now+90*86400000) return [];
    const [startsAt] = candidates;
    const id = 'visit-linkoping-'+createHash('sha256').update(url+'|'+local).digest('hex').slice(0,32);
    return [{id,title,venueName,organizer,startsAt,municipality:'Linköping',
      category:/konsert|livemusik/i.test(title) ? 'musik' : /pettson|barnteater/i.test(title) ? 'familj' : 'kultur',
      source:'visit-linkoping',sourceUrl:url}];
  });
}

export async function upcomingLinkopingEvents(now = new Date()) {
  const html = await fetchCalendar(calendar);
  const links = [...new Set([...html.matchAll(/href="((?:https:\/\/visitlinkoping\.se)?\/evenemang\/[a-z0-9-]+\/)"/gi)]
    .map(([,href])=>new URL(href,calendar).href))];
  if (!links.length) throw new Error('Visit Linköpings evenemangslänkar kunde inte läsas.');
  const events = [];
  let failed = 0;
  for (let i=0;i<links.length;i+=5) {
    const results = await Promise.allSettled(links.slice(i,i+5).map(async url=>parseLinkopingEvent(await fetchCalendar(url),url,now)));
    for (const result of results) {
      if (result.status === 'fulfilled') events.push(...result.value);
      else failed++;
    }
  }
  if (failed === links.length) throw new Error('Visit Linköpings detaljsidor kunde inte nås.');
  if (failed) console.warn('Visit Linköping: misslyckade detaljsidor:',failed);
  return events;
}
