// Conservative price extraction: never infer that a missing price means free.
const day = new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Stockholm'});
const normal = value => plain(value).normalize('NFC').toLocaleLowerCase('sv').replace(/[^\p{L}\p{N}]+/gu,' ').trim();
function plain(value) {
  return String(value ?? '').replace(/<[^>]*>/g,' ').replace(/&nbsp;|&#160;/gi,' ')
    .replace(/&amp;/gi,'&').replace(/&quot;/gi,'"').replace(/&#(\d+);/g,(_,n)=>String.fromCodePoint(Math.min(Number(n),0x10ffff))).replace(/\s+/g,' ').trim();
}
function amount(value) {
  if (typeof value==='number') return Number.isFinite(value)&&value>=0&&value<=1000000 ? value : null;
  const text=String(value??'').trim().replace(/\u00a0/g,' ');
  if (!/^(?:\d{1,3}(?: \d{3})+|\d+)(?:[.,]\d{1,2})?$/.test(text)) return null;
  const n=Number(text.replace(/ /g,'').replace(',','.'));
  return n<=1000000 ? n : null;
}
function result(values,from=false) {
  if (!values.length || values.some(v=>v===null)) return {};
  if (values.some(v=>v===0)&&values.some(v=>v>0)) return {}; // e.g. free children and paid adults
  if (values.every(v=>v===0)) return {priceType:'free',priceAmount:null};
  return {priceType:from||new Set(values).size>1?'from':'fixed',priceAmount:Math.min(...values)};
}
export function apiCost(cost) {
  const text=plain(cost);
  if (/^(gratis|fri entré|kostnadsfritt)$/iu.test(text)) return {priceType:'free',priceAmount:null};
  const match=text.match(/^(från\s+)?([\d ,.]+)\s*(?:kr|SEK)$/iu);
  return match ? result([amount(match[2].trim())],Boolean(match[1])) : {};
}
function stamp(value) { return value?.toDate ? value.toDate() : new Date(value); }
function sameDay(value,event) {
  const date=stamp(event.startsAt);const other=new Date(value);
  if (!Number.isFinite(+date)||!Number.isFinite(+other))return false;
  return day.format(date)===day.format(other);
}
function walk(value,events=[]) {
  if (Array.isArray(value)) { for (const child of value) walk(child,events); }
  else if(value && typeof value==='object') {
    const types=[value['@type']].flat();
    if(types.some(t=>typeof t==='string' && /(?:^|\/)\w*Event$/.test(t))) events.push(value);
    if(value['@graph'])walk(value['@graph'],events);
    if(value.mainEntity)walk(value.mainEntity,events);
  }
  return events;
}
export function extractPrice(html,event) {
  const matched=[];let structuredSeen=false;
  for(const script of html.matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      for(const node of walk(JSON.parse(script[1]))) {
        if(normal(node.name)!==normal(event.title)||!sameDay(node.startDate,event))continue;
        structuredSeen=true;
        const offers=[node.offers??[]].flat();
        const prices=[];let from=false,unsupported=false;
        for(const offer of offers) {
          if (!offer || typeof offer!=='object') {unsupported=true;continue;}
          if(String(offer.priceCurrency??'').toUpperCase()!=='SEK') {unsupported=true;continue;}
          const raw=offer.lowPrice??offer.price;
          const price=amount(raw);
          if(price===null) {unsupported=true;continue;}
          prices.push(price);from ||= offer.lowPrice!==undefined && (offer.highPrice===undefined||amount(offer.highPrice)!==price);
        }
        if(!unsupported&&prices.length) matched.push(result(prices,from));
        else if(!offers.length&&node.isAccessibleForFree===true)matched.push({priceType:'free',priceAmount:null});
      }
    }catch{} // malformed structured data must not break the event import
  }
  const known=matched.filter(x=>x.priceType);
  if(known.length) return known.every(x=>x.priceType===known[0].priceType&&x.priceAmount===known[0].priceAmount)?known[0]:{};
  if(structuredSeen)return {};
  // Only use labelled visible text when a single page heading and a date identify this event.
  const main=html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i)?.[1]??html;
  const content=main.replace(/<(script|style|nav|footer|aside)\b[^>]*>[\s\S]*?<\/\1>/gi,'');
  const headings=[...content.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi)];
  if(headings.length!==1||normal(headings[0][1])!==normal(event.title))return {};
  const date=stamp(event.startsAt);if(!Number.isFinite(+date))return {};
  const iso=day.format(date);const months='januari februari mars april maj juni juli augusti september oktober november december'.split(' ');
  const [y,m,d]=iso.split('-');
  if(!content.includes(iso)&&!new RegExp('\\b'+Number(d)+'\\s+'+months[Number(m)-1]+'\\s+'+y+'\\b','iu').test(plain(content)))return {};
  const lines=content.replace(/<\/(?:p|div|li|h[1-6]|section|tr)>|<br\s*\/?\s*>/gi,'\n').split('\n').map(plain).filter(Boolean);
  const candidates=[];
  for(let index=0;index<lines.length;index++) {
    let line=lines[index];
    if (/^(?:pris|entré|entrépris|biljettpris|kostnad)\s*:\s*$/iu.test(line)) line+=' '+(lines[index+1] || '');
    const labelled=line.match(/^(?:pris|entré|entrépris|biljettpris|kostnad)\s*:\s*(.+)$/iu);
    if(labelled)candidates.push(apiCost(labelled[1]));
    else if(/^(?:fri entré|gratis inträde)$/iu.test(line))candidates.push({priceType:'free',priceAmount:null});
  }
  if(candidates.some(x=>!x.priceType))return {};
  return candidates.length&&candidates.every(x=>x.priceType===candidates[0].priceType&&x.priceAmount===candidates[0].priceAmount)?candidates[0]:{};
}

// Retain a bounded set of pages already fetched by the calendar parsers.
const pages=new Map();let bytes=0;
export function rememberPricePage(url,html) {
  if(typeof html!=='string'||html.length>1000000||!/<(?:html|main|h1|script)\b/i.test(html))return;
  const key=String(url);if(pages.has(key))bytes-=pages.get(key).length;
  pages.set(key,html);bytes+=html.length;
  while(bytes>20000000||pages.size>150){const key=pages.keys().next().value;bytes-=pages.get(key).length;pages.delete(key);}
}
export function rememberedPrice(url,event) {const html=pages.get(String(url));return html===undefined?null:extractPrice(html,event);}
const allowed=new Set(['www.arbis.se','arbis.se','visit.norrkoping.se','visitlinkoping.se','www.linkoping.se','motalasjostad.se','www.julmarknad.nu','www.hemslojdeniostergotland.se','www.brunnebymusteri.se','vadstenaslott.com','www.soderkoping.se']);
export async function enrichPrices(records,{request=fetch,maxRequests=12,concurrency=3}={}) {
  const jobs=new Map();let verified=0,failed=0,extra=0;
  for(const {target,entry} of records) {
    if(target!=='events')continue;
    if(entry.priceType){entry.priceSourceUrl ||= entry.sourceUrl;verified++;continue;}
    const cached=rememberedPrice(entry.sourceUrl,entry);
    if(cached!==null){if(cached.priceType){Object.assign(entry,cached,{priceSourceUrl:entry.sourceUrl});verified++;}continue;}
    try {const url=new URL(entry.sourceUrl);if(url.protocol!=='https:'||!allowed.has(url.hostname))continue;}catch{continue;}
    if(!jobs.has(entry.sourceUrl))jobs.set(entry.sourceUrl,[]);jobs.get(entry.sourceUrl).push(entry);
  }
  // Rotate a bounded set daily so recurring runs cover more sources without long imports.
  const urls=[...jobs.keys()].sort();const offset=urls.length?(Math.floor(Date.now()/86400000)*maxRequests)%urls.length:0;
  const selected=urls.slice(offset).concat(urls.slice(0,offset)).slice(0,maxRequests);
  for(let i=0;i<selected.length;i+=concurrency)await Promise.all(selected.slice(i,i+concurrency).map(async url=>{
    extra++;
    try {
      const response=await request(url,{signal:AbortSignal.timeout(7000),redirect:'error',headers:{'User-Agent':'UtIOst-EventImporter/1.0 (+https://utiost.se)','Accept':'text/html'}});
      if(!response.ok){await response.body?.cancel();failed++;return;}
      const html=await response.text();if(html.length>2000000){failed++;return;}
      for(const entry of jobs.get(url)){const price=extractPrice(html,entry);if(price.priceType){Object.assign(entry,price,{priceSourceUrl:url});verified++;}}
    }catch{failed++;}
  }));
  console.log('Prisinhämtning:',verified,'verifierade priser ·',extra,'extra sidförfrågningar ·',failed,'kunde inte hämtas');
  return {verified,extra,failed};
}
