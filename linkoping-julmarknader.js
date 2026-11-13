import { fetchCalendar } from './fetch-calendar.js';
const gamlaLinkoping = 'https://gamlalinkoping.se/evenemang/gamlalinkopingsjulmarknad.4.58068221a0421405eca0e.html';
const hemslojden = 'https://www.linkoping.se/uppleva-och-gora/evenemang-i-linkoping/evenemangskalender/evenemangskalender/2026-10-29-julmarknad-pa-hemslojden';
const ekenas = 'https://svenska-slottsmassor.se/vara-massor/jul-pa-ekenas-slott/';
const localDay = new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Stockholm'});
const weekday = new Intl.DateTimeFormat('sv-SE',{timeZone:'UTC',weekday:'long'});
const museumDays = ['2026-11-28','2026-11-29','2026-12-05','2026-12-06'];

function market(key,title,venueName,sourceUrl,startsAt) {
  const day = localDay.format(startsAt);
  return {
    id:'linkoping-julmarknad-'+key+'-'+day,title,venueName,sourceUrl,startsAt,
    municipality:'Linköping',category:'julmarknad',source:'linkoping-julmarknader'
  };
}

function novemberStart(day,time) {
  // These source schedules are in November and December 2026, when Stockholm uses CET.
  return new Date(day+'T'+time+':00+01:00');
}

function craftMarket(html) {
  const raw = html.match(/Datum:<\/strong>\s*<time\s+datetime="([^"]+)"/i)?.[1];
  const startsAt = new Date(raw);
  if (!raw || !Number.isFinite(startsAt.getTime()) || !/^2026-(11|12)-/.test(raw)) {
    throw new Error('Hemslöjdens datum kunde inte läsas.');
  }
  return [market('hemslojden','Julmarknad på Hemslöjden','Hemslöjdsgården, Läroverksgatan 7',hemslojden,startsAt)];
}

function castleMarket(html) {
  const content = html.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ');
  const info = content.match(/Datum för mässan:\s*(2026-11-\d{2})\s*[-–]\s*(2026-11-\d{2})\s*Öppettider:\s*(.*?)\s*Entré:/i);
  if (!info) throw new Error('Ekenäs datum och öppettider kunde inte läsas.');
  const hours = new Map([...info[3].matchAll(/(måndag|tisdag|onsdag|torsdag|fredag|lördag|söndag)\s+(\d{1,2})(?::(\d{2}))?\s*[-–]\s*\d{1,2}/gi)]
    .map(([,day,hour,minute])=>[day.toLowerCase(),hour.padStart(2,'0')+':'+(minute ?? '00')]));
  const start = Date.parse(info[1]+'T12:00:00Z');
  const end = Date.parse(info[2]+'T12:00:00Z');
  if (!hours.size || !Number.isFinite(start) || end < start || end-start>6*86400000) {
    throw new Error('Ekenäs öppettider kunde inte verifieras.');
  }
  const rows = [];
  for (let stamp=start; stamp<=end; stamp+=86400000) {
    const date = new Date(stamp);
    const hour = hours.get(weekday.format(date));
    if (!hour) throw new Error('En marknadsdag på Ekenäs saknar öppettid.');
    rows.push(market('ekenas','Julmarknad på Ekenäs slott','Ekenäs slott',ekenas,novemberStart(date.toISOString().slice(0,10),hour)));
  }
  return rows;
}

export async function linkopingChristmasMarkets(now = new Date(), request = fetch) {
  if (localDay.format(now) > '2026-12-06') return [];

  // Gamla Linköpings four days were checked against the organiser's published schedule.
  const museum = museumDays.map(day=>market(
    'gamla-linkoping','Gamla Linköpings julmarknad','Gamla Linköpings stadskvarter',
    gamlaLinkoping,novemberStart(day,'11:00')
  ));
  const today = localDay.format(now);
  const sources = [[hemslojden,craftMarket]];
  if (today <= '2026-11-15') sources.push([ekenas,castleMarket]);
  const results = await Promise.allSettled(sources.map(async ([url,parse])=>{
    return parse(await fetchCalendar(url,request));
  }));
  const rows = [...museum];
  for (const result of results) {
    if (result.status === 'fulfilled') rows.push(...result.value);
    else console.warn('Linköpings julmarknader:',result.reason.message);
  }
  return rows.filter(row=>localDay.format(row.startsAt)>=today).sort((a,b)=>a.startsAt-b.startsAt);
}
