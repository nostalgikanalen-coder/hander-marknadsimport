import { fetchCalendar } from './fetch-calendar.js';

const endpoint = 'https://motalasjostad.se/wp-json/tribe/events/v1/events';
export async function upcomingMotalaEvents(now = new Date(), request = fetch) {
  const end = new Date(+now + 60 * 86400000);
  const rows = new Map();
  for (let page = 1; page <= 10; page++) {
    const url = new URL(endpoint);
    url.search = new URLSearchParams({
      start_date:now.toISOString().slice(0,10), end_date:end.toISOString().slice(0,10),
      per_page:'50',page:String(page)
    });
    const data = JSON.parse(await fetchCalendar(url.href,request));
    if (!Array.isArray(data.events)) throw new Error('Motala Sjöstad: oväntat kalendersvar.');
    for (const event of data.events) {
      const title = String(event.title ?? '').replace(/&#(\d+);/g,(entity,code)=>
        Number(code)<=0x10ffff ? String.fromCodePoint(Number(code)) : entity).replace(/&amp;/g,'&').trim();
      const tags = (event.categories ?? []).map(item=>item.slug).join(' ');
      const startsAt = new Date(String(event.utc_start_date).replace(' ','T')+'Z');
      const venueName = event.venue?.venue?.trim();
      if (event.status !== 'publish' || event.all_day || event.is_virtual || event.hide_from_listings
        || !Number.isInteger(event.id) || !title || !venueName || !Number.isFinite(+startsAt)
        || startsAt < now || startsAt >= end || !event.url?.startsWith('https://motalasjostad.se/')
        || /sport|idrott/.test(tags) || /julmarknad|sjöstadsjul|inställt|uppskjut/i.test(title)) continue;
      const category = /barn|familj/.test(tags) ? 'familj' : /teater|utstall|kultur/.test(tags) ? 'kultur'
        : /musik/.test(tags) ? 'musik' : /loppis|marknad/.test(tags) ? 'loppis' : 'annat';
      rows.set(event.id,{
        id:'motala-sjostad-'+event.id,title,startsAt,venueName,municipality:'Motala',
        category,source:'motala-sjostad',sourceUrl:event.url
      });
    }
    if (page >= Number(data.total_pages) || !data.events.length) break;
  }
  return [...rows.values()];
}
