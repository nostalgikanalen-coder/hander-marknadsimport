// Shared WordPress discovery. Publication dates are NEVER used as event dates.
import {fetchCalendar} from './fetch-calendar.js';
import {apiCost} from './event-prices.js';
const months='januari februari mars april maj juni juli augusti september oktober november december'.split(' ');
const dayClock=new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Stockholm'});
const timeClock=new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Stockholm',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
export function text(html='') {
  return String(html).replace(/<[^>]*>/g,' ').replace(/&#x([\da-f]+);/gi,(_,n)=>String.fromCodePoint(parseInt(n,16)))
    .replace(/&#(\d+);/g,(_,n)=>String.fromCodePoint(Math.min(Number(n),0x10ffff)))
    .replace(/&nbsp;/gi,' ').replace(/&amp;/gi,'&').replace(/&quot;/gi,'"').replace(/&(?:apos|#39);/gi,"'")
    .replace(/&ndash;/gi,'–').replace(/&mdash;/gi,'—').replace(/\s+/g,' ').trim();
}
function dateLabel(value) {
  const m=text(value).toLowerCase().match(/^(\d{1,2})\s+([a-zåäö]+)\s+(20\d{2})$/u);
  if(!m)return null;
  const month=months.indexOf(m[2])+1;if(!month)return null;
  const iso=`${m[3]}-${String(month).padStart(2,'0')}-${m[1].padStart(2,'0')}`;
  const date=new Date(iso+'T12:00:00Z');
  return Number.isFinite(+date)&&date.toISOString().slice(0,10)===iso ? iso : null;
}
export function stockholmDate(day,time='00:00') {
  if(!/^\d{2}:\d{2}$/.test(time))return null;
  const utc=Date.parse(day+'T'+time+':00Z');
  const matches=[1,2].map(offset=>new Date(utc-offset*3600000))
    .filter(date=>Number.isFinite(+date)&&dayClock.format(date)===day&&timeClock.format(date)===time);
  return matches.length===1 ? matches[0] : null;
}
function spans(html,word) {
  return [...html.matchAll(new RegExp('<span\\b[^>]*class=["\'][^"\']*\\b'+word+'\\b[^"\']*["\'][^>]*>([\\s\\S]*?)<\\/span>','gi'))].map(m=>text(m[1]));
}
function cell(html,icon) {
  return text(html.match(new RegExp('<i\\b[^>]*'+icon+'[^>]*>[\\s\\S]*?<\\/i>([\\s\\S]*?)<\\/p>','i'))?.[1]??'');
}
function ticketPrice(html) {
  // Only the ticket table: cloakroom, meals and donations must never become ticket prices.
  const table=html.match(/<tbody\b[^>]*class=["']tickets["'][^>]*>([\s\S]*?)<\/tbody>/i)?.[1]??'';
  const values=[];
  for(const row of table.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells=[...row[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map(m=>text(m[1]));
    if(cells.length!==2)continue;
    const price=apiCost(cells[1]);
    if(!price.priceType)return {};
    values.push(price.priceType==='free'?0:price.priceAmount);
  }
  if(!values.length||values.some(x=>x===0)&&values.some(x=>x>0))return {};
  if(values.every(x=>x===0))return {priceType:'free',priceAmount:null};
  return {priceType:new Set(values).size===1?'fixed':'from',priceAmount:Math.min(...values)};
}
export function parseWordpressEvent(post,html,kind) {
  // Restrict parsing to this page's hero, excluding navigation and recommended events.
  const start=kind==='ldg' ? html.indexOf('<h1') : html.indexOf('single-'+(kind==='exhibition'?'exhibition':'event')+'-hero');
  if(start<0)return null;
  const body=html.slice(start);
  const hero=kind==='ldg'?body.split('<!-- End of hero section -->')[0]:body.split('<p class="photo-cred">')[0].split('<div class="entry-content')[0];
  const title=text(hero.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1]);
  if(!title||title.length>300)return null;
  const dates=kind==='ldg'?[cell(hero,'fa-calendar-days')]:spans(hero,'date');
  const days=dates.map(dateLabel);
  if(!days.length||days.some(x=>!x)||days.length>2||kind==='ldg'&&days.length!==1)return null;
  if(kind==='exhibition') {
    const location=spans(hero,'event-location').join(' ');
    if(!/^(?:Plan\s+\d|Våning\s+\d|Arbetets museum)/iu.test(location)||/turner|digital/iu.test(text(hero)))return null;
  }
  const times=kind==='ldg'?[cell(hero,'fa-clock')]:spans(hero,'event-time');
  const time=times[0]?.match(/^\d{1,2}:\d{2}$/)?.[0];
  if(kind!=='exhibition'&&!time)return null;
  const startsAt=stockholmDate(days[0],time?.padStart(5,'0')??'00:00');
  if(!startsAt)return null;
  let endsAt;
  if(kind==='exhibition') {
    // No fabricated closing date for permanent / "tills vidare" exhibitions.
    if(days.length!==2)return null;
    endsAt=stockholmDate(days[1],'23:59');
  } else if(times[1]&&/^\d{1,2}:\d{2}$/.test(times[1])) {
    endsAt=stockholmDate(days.at(-1),times[1].padStart(5,'0'));
  }
  if(endsAt&&endsAt<=startsAt)return null;
  const venue=kind==='ldg'?cell(hero,'fa-location-dot'):'Arbetets museum';
  if(!venue||kind==='ldg'&&!/^(Flygeln|De Geerhallen|Louis De Geer(?: Konsert ?& ?Kongress)?|Hemerycksalen|Värmekyrkan)$/i.test(venue))return null;
  const source=kind==='ldg'?'louis-de-geer':'arbetets-museum';
  const entry={id:source+'-'+post.id,title,startsAt,municipality:'Norrköping',venueName:venue,
    source,sourceUrl:post.link,category:kind==='exhibition'?'utstallning':'kultur',
    // General facts and a source link; category images remain the site's own images.
    description:kind==='exhibition'?'Utställning på Arbetets museum. Se arrangörens sida för innehåll och öppettider.':'Se arrangörens sida för program och praktisk information.',
    dateOnly:kind==='exhibition',cancelled:/\binställ(?:t|d|da)\b/iu.test(title)};
  if(endsAt)entry.endsAt=endsAt;
  if(kind==='exhibition')Object.assign(entry,{eventType:'exhibition',exhibitionHours:'Se museets aktuella öppettider och avvikande öppettider.'});
  if(kind!=='ldg')entry.address='Laxholmen, Norrköping';
  if(kind==='ldg') {
    Object.assign(entry,ticketPrice(body));
    const organizer=body.match(/<td>\s*<strong>Arrangör<\/strong>\s*<\/td>\s*<td>([\s\S]*?)<\/td>/i)?.[1];
    if(organizer)entry.organizer=text(organizer);
  } else {
    entry.organizer='Arbetets museum';
    // A site-wide "fri entré" banner alone does not prove that a special event is free.
    const content=body.match(/<div class="entry-content[^>]*>([\s\S]*?)<\/div>/i)?.[1]??'';
    if(kind==='event'&&/julmarknad/iu.test(text(content).slice(0,400)))entry.category='julmarknad';
    if(/(?:samtalet|evenemanget|aktiviteten) är kostnadsfritt/iu.test(text(content)) || /fri entré/iu.test(text(content))&&!/\d+\s*(?:kr|SEK|:-)/iu.test(text(content)) || kind==='exhibition'&&/alltid fri entré/iu.test(text(html)))Object.assign(entry,{priceType:'free',priceAmount:null});
  }
  return entry;
}
async function posts(origin,type,request) {
  const rows=[];
  for(let page=1;page<=10;page++) {
    const url=origin+'/wp-json/wp/v2/'+type+'?per_page=100&page='+page+'&_fields=id,link,title,modified_gmt,evenemang_category';
    const response=await request(url,{signal:AbortSignal.timeout(20000),headers:{Accept:'application/json','User-Agent':'UtIOst-EventImporter/1.0 (+https://utiost.se)'}});
    if(!response.ok)throw new Error(type+': WordPress HTTP '+response.status);
    const data=await response.json();if(!Array.isArray(data))throw new Error('WordPress gav inte en postlista.');
    rows.push(...data);
    const pages=Number(response.headers.get('X-WP-TotalPages'));
    if(pages>10)throw new Error('WordPress listan överstiger säkerhetsgränsen 1000 poster.');
    if(pages ? page>=pages : data.length<100)return rows;
  }
  throw new Error('WordPress sidindelning kunde inte avslutas.');
}
async function load(origin,type,kind,now,request) {
  const discovered=await posts(origin,type,request);
  let terms=[];
  if(kind==='ldg') {
    const response=await request(origin+'/wp-json/wp/v2/evenemang_category?per_page=100&_fields=id,name',{signal:AbortSignal.timeout(20000)});
    if(!response.ok)throw new Error('Kategorier: WordPress HTTP '+response.status);
    terms=await response.json();
    if(!Array.isArray(terms))throw new Error('WordPress gav ingen kategorilista.');
  }
  const items=[];let failed=0,unreadable=0;
  // Three simultaneous requests, to avoid hammering the organizer's website.
  for(let offset=0;offset<discovered.length;offset+=3) {
    const group=await Promise.allSettled(discovered.slice(offset,offset+3).map(async post=>{
      const url=new URL(post.link);
      if(url.origin!==origin||!new RegExp('^/'+(kind==='ldg'?'evenemang':kind==='exhibition'?'utstallning':'evenemang')+'/[^/]+/?$').test(url.pathname))return null;
      const item=parseWordpressEvent(post,await fetchCalendar(url.href,request),kind);
      if(item&&kind==='ldg') {
        const labels=terms.filter(term=>post.evenemang_category?.includes(term.id)).map(term=>text(term.name)).join(' ');
        if(/familj|barn/iu.test(labels))item.category='familj';
        else if(/konsert|musik|orkester|jazz|blues|rock|pop|schlager|country|soul|punk|kör|klassiskt|dansband|a cappella|hip hop|progg/iu.test(labels))item.category='musik';
      }
      return item;
    }));
    for(const result of group) {
      if(result.status==='rejected'){failed++;continue;}
      const item=result.value;
      if(!item){unreadable++;continue;}
      if(dayClock.format(item.endsAt??item.startsAt)>=dayClock.format(now))items.push(item);
    }
  }
  console.log(`${origin}: ${discovered.length} WordPress-poster · ${items.length} kommande/pågående · ${unreadable} utan entydiga uppgifter · ${failed} hämtningsfel`);
  if(failed)throw new Error(`${failed} detaljsidor kunde inte läsas; denna källa behåller föregående import.`);
  if(discovered.length&&!items.length&&unreadable===discovered.length)throw new Error('Inga datum kunde tolkas. Källans format behöver kontrolleras.');
  return items;
}
export function upcomingLouisDeGeerEvents(now=new Date(),request=fetch) {
  return load('https://louisdegeer.se','evenemang','ldg',now,request);
}
export async function upcomingArbetetsEvents(now=new Date(),request=fetch) {
  const events=await load('https://www.arbetetsmuseum.se','event','event',now,request);
  const exhibitions=await load('https://www.arbetetsmuseum.se','exhibition','exhibition',now,request);
  return [...events,...exhibitions];
}
