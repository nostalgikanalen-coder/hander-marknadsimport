import { createHash } from 'node:crypto';

const calendar = 'https://visit.norrkoping.se/se-och-gora/evenemangskalender';
const christmasCalendar = 'https://visit.norrkoping.se/se-och-gora/temasidor/vinterkoping/julmarknader-i-norrkoping-2026';
const christmasCutoff = new Date('2027-01-01T00:00:00+01:00');
const dailyMarkets = new Set(['jul-pa-grensholm','hallbar-design--och-hantverksmarknad-pa-arbetets-museum']);
const months = 'jan feb mar apr maj jun jul aug sep okt nov dec'.split(' ');
const fullMonths = 'januari februari mars april maj juni juli augusti september oktober november december'.split(' ');
const stockholm = new Intl.DateTimeFormat('sv-SE',{
  timeZone:'Europe/Stockholm', year:'numeric',month:'2-digit',day:'2-digit',
  hour:'2-digit',minute:'2-digit',hourCycle:'h23'
});
const entities = {amp:'&',quot:'"',apos:"'",lt:'<',gt:'>',nbsp:' ',ndash:'–',mdash:'—',aring:'å',auml:'ä',ouml:'ö',Aring:'Å',Auml:'Ä',Ouml:'Ö'};

function plain(html = '') {
  return html.replace(/<[^>]+>/g,'').replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi,(entity,key) => {
    if (key === '#150') return '–';
    if (key.startsWith('#')) {
      const point = key[1].toLowerCase() === 'x' ? Number.parseInt(key.slice(2),16) : Number(key.slice(1));
      return point <= 0x10ffff ? String.fromCodePoint(point) : entity;
    }
    return Object.hasOwn(entities,key) ? entities[key] : entity;
  }).replace(/\s+/g,' ').trim();
}

export function listEvents(html) {
  const links = new Map();
  for (const [,item] of html.matchAll(/<li class="vn-search__hit[\s"][^>]*>([\s\S]*?)<\/li>/g)) {
    const href = item.match(/href="([^"]+)"/)?.[1];
    if (!href) continue;
    const url = new URL(plain(href),calendar);
    if (url.origin !== new URL(calendar).origin || !/\/evenemangskalender\/evenemang-[a-z]+-\d{4}\/[^/]+$/i.test(url.pathname)) continue;
    const category = plain(item.match(/Kategori:<\/span>([\s\S]*?)<\/div>/)?.[1]);
    links.set(url.href,category);
  }
  return links;
}

function startDate(label, time, url, christmas) {
  const date = label.match(/^(\d{1,2})\s+([a-z]{3})(?:\s+(\d{4}))?$/i);
  const hour = time.match(/^(\d{1,2}):(\d{2})(?:\s*[–—-]|$)/);
  if (!date || !hour) return null;
  const month = months.indexOf(date[2].toLowerCase());
  const folder = new URL(url).pathname.match(/\/evenemang-([a-z]+)-(\d{4})\//);
  const sameSeason = christmas && folder?.[2] === '2026' && [10,11].includes(month);
  if (month < 0 || (!date[3] && folder?.[1] !== fullMonths[month] && !sameSeason)) return null;
  const year = date[3] ?? folder[2];
  const pad = value => String(value).padStart(2,'0');
  const local = year + '-' + pad(month+1) + '-' + pad(date[1]) + ' ' + pad(hour[1]) + ':' + hour[2];
  const base = Date.parse(local.replace(' ','T') + ':00Z');
  const candidates = [1,2].map(offset => new Date(base-offset*3600000))
    .filter(candidate => Number.isFinite(candidate.getTime()) && stockholm.format(candidate) === local);
  return candidates.length === 1 ? candidates[0] : null;
}

export function parseEvent(html, url, tags, now = new Date(), christmas = false) {
  const title = plain(html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1]);
  if (!title || /\b(inställt|inställd|uppskjutet|uppskjuten)\b/i.test(title)) return [];
  const address = plain(html.match(/vn-object-page__information-box-metadata-address[^>]*><\/span>Adress<\/div>\s*<div[^>]*>([\s\S]*?)<\/div>/)?.[1]);
  const slug = new URL(url).pathname.split('/').at(-1);
  const hemgarden = christmas && slug === 'julmarknad-pa-hemgarden-' && /^saltängsgatan 7$/i.test(address);
  if (!hemgarden && !/(?:^|[^\p{L}])(?:norrköping|kolmården|krokek|vikbolandet|skärblacka|kimstad|norsholm|svärtinge|åby|ljunga|östra husby)(?!\p{L})/iu.test(address)
    && !/\b60[1-6]\s?\d{2}\b/.test(address)) return [];
  const categories = [[/loppis|marknad/i,'loppis'],[/musik/i,'musik'],[/familj/i,'familj'],
    [/sport|idrott/i,'sport'],[/mat/i,'mat'],[/teater|konst|museum|utställning|föreläsning/i,'kultur']];
  const category = christmas ? 'loppis' : categories.find(([pattern]) => pattern.test(tags))?.[1] ?? 'annat';
  const occasions = html.split('class="vn-object-page__occasion-item"').slice(1);
  const events = new Map();
  for (const occasion of occasions) {
    const label = plain(occasion.match(/vn-object-page__occasion-item-left">([\s\S]*?)<\/div>/)?.[1]);
    const venueName = plain(occasion.match(/Plats:<\/span>([\s\S]*?)<\/div>/)?.[1]);
    const time = plain(occasion.match(/Tid:<\/span>([\s\S]*?)<\/div>/)?.[1]);
    const range = christmas && dailyMarkets.has(slug)
      ? label.match(/^(\d{1,2})\s*[–—-]\s*(\d{1,2})\s+([a-z]{3})(?:\s+(20\d{2}))?$/i)
      : null;
    const labels = range && Number(range[2])-Number(range[1]) === 1
      ? [range[1],range[2]].map(day=>[day,range[3],range[4]].filter(Boolean).join(' '))
      : [label];
    for (const day of labels) {
      const startsAt = startDate(day,time,url,christmas);
      if (!venueName || !startsAt || startsAt < now) continue;
      const id = 'visit-norrkoping-' + createHash('sha256').update(url + '|' + startsAt.toISOString()).digest('hex').slice(0,32);
      events.set(id,{id,title,startsAt,venueName,municipality:'Norrköping',category,source:'visit-norrkoping',sourceUrl:url});
    }
  }
  return [...events.values()];
}

export function christmasMarketLinks(html) {
  const result = new Set();
  for (const [,href] of html.matchAll(/href="([^"]+)"/g)) {
    if (!href.includes('/evenemangskalender/evenemang-')) continue;
    const url = new URL(plain(href),christmasCalendar);
    if (url.origin === new URL(calendar).origin
      && /\/evenemangskalender\/evenemang-(?:november|december)-2026\/[^/]+$/.test(url.pathname)) {
      result.add(url.origin+url.pathname);
    }
  }
  return result;
}

export async function upcomingVisitEvents(now = new Date(), request = fetch) {
  async function read(url) {
    const response = await request(url,{signal:AbortSignal.timeout(15000)});
    if (!response.ok) throw new Error('Visit Norrköping HTTP ' + response.status);
    return response.text();
  }
  const links = new Map();
  const maxPages = 6;
  for (let page=1; page<=maxPages; page++) {
    let html;
    try {
      html = await read(page === 1 ? calendar : calendar + '?page=' + page);
    } catch (error) {
      if (page === 1) throw error;
      console.warn('Visit Norrköping: avbröt sidläsning vid sida',page,error.message);
      break;
    }
    const results = listEvents(html);
    if (!results.size) {
      if (page === 1) throw new Error('Visit Norrköpings kalenderformat kunde inte läsas.');
      break;
    }
    for (const [url,tags] of results) links.set(url,tags);
  }
  let christmas = new Set();
  if (now < christmasCutoff) {
    try {
      christmas = christmasMarketLinks(await read(christmasCalendar));
      for (const url of christmas) links.set(url,'Loppis & marknad');
    } catch (error) {
      console.warn('Visit Norrköpings julmarknader kunde inte läsas:',error.message);
    }
  }
  const events = [];
  const entries = [...links];
  let failed = 0;
  const parallelRequests = 5;
  for (let i=0; i<entries.length; i+=parallelRequests) {
    const results = await Promise.allSettled(entries.slice(i,i+parallelRequests).map(async ([url,tags]) => parseEvent(await read(url),url,tags,now,christmas.has(url))));
    for (const result of results) {
      if (result.status === 'fulfilled') events.push(...result.value);
      else failed++;
    }
  }
  if (failed) console.warn('Visit Norrköping: sidor som inte kunde läsas:',failed);
  if (failed === entries.length) throw new Error('Evenemangssidorna kunde inte hämtas.');
  return events;
}
