// Public calendar adapter and standalone read-only preview. Only sync.js writes to Firestore.
import {writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
const site='https://www.gotabiblioteken.se';
const towns='Boxholm Finspång Kinda Linköping Mjölby Motala Norrköping Söderköping Vadstena Valdemarsvik Ydre Åtvidaberg Ödeshög'.split(' ');
const entities={amp:'&',nbsp:' ',quot:'"',apos:"'",aring:'å',Aring:'Å',auml:'ä',Auml:'Ä',ouml:'ö',Ouml:'Ö',eacute:'é',Eacute:'É',ndash:'–',mdash:'—'};
function plain(value='') {
  return String(value??'').replace(/<[^>]*>/g,' ').replace(/&#x([\da-f]+);/gi,(_,n)=>String.fromCodePoint(Math.min(parseInt(n,16),0x10ffff)))
    .replace(/&#(\d+);/g,(_,n)=>String.fromCodePoint(Math.min(Number(n),0x10ffff)))
    .replace(/&([A-Za-z]+);/g,(m,n)=>entities[n]??m).replace(/\s+/g,' ').trim();
}
const key=value=>plain(value).normalize('NFC').toLocaleLowerCase('sv').replace(/[^\p{L}\p{N}]+/gu,' ').trim();
const libraryKey=value=>key(value).replace(/s bibliotek$/u,' bibliotek');
async function fetchPublic(url,request=fetch,options={}) {
  const response=await request(url,{...options,signal:AbortSignal.timeout(20000)});
  if(!response.ok)throw new Error(new URL(url).hostname+' svarade HTTP '+response.status);
  return response;
}
export function libraryMunicipalities(html) {
  const map=new Map();let municipality='';
  for(const match of html.matchAll(/<h2\b[^>]*>([\s\S]*?)<\/h2>/gi)) {
    const label=plain(match[1]);
    if(/\s+kommun$/iu.test(label)) {
      const name=key(label.replace(/\s+kommun$/iu,''));
      municipality=towns.find(town=>name===key(town)||name===key(town)+'s')??'';
      continue;
    }
    if(municipality&&/(?:bibliotek(?:sbuss)?|bokbuss)$|^Bibliotek\s/iu.test(label)) {
      const name=libraryKey(label);const existing=map.get(name);
      if(existing&&existing!==municipality)throw new Error('Biblioteksnamnet är tvetydigt: '+label);
      map.set(name,municipality);
    }
  }
  if(map.size<13)throw new Error('Biblioteksförteckningens format kunde inte läsas säkert.');
  return map;
}
async function calendarConfig(request) {
  const page=await fetchPublic(site+'/program',request);const html=await page.text();
  const groupId=html.match(/getScopeGroupId\s*:\s*function\(\)\s*\{return\s*["'](\d+)["']/)?.[1];
  if(!groupId)throw new Error('Kalenderns publika grupp-ID saknas.');
  const token=html.match(/Liferay\.authToken\s*=\s*["']([^"']+)/)?.[1];
  // Follow the same public Liferay.Service read call as the website; no login.
  const cookie=(page.headers.getSetCookie?.()??[]).map(value=>value.split(';')[0]).join('; ');
  const body=new URLSearchParams({cmd:JSON.stringify({'/arenacalendar.calendar/get-calendar-config':{groupId}})});
  if(token)body.set('p_auth',token);
  const response=await fetchPublic(site+'/api/jsonws/invoke',request,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded',...(cookie?{Cookie:cookie}:{})},body});
  const config=await response.json();
  if(config.calendarApiEndpoint!=='https://api.axiell.com/event/api'||! /^[a-f0-9]{24}$/i.test(config.customerId??''))throw new Error('Kalenderns API-inställningar kunde inte verifieras.');
  return config;
}
function explicitPrice(description) {
  const text=plain(description);
  const labelled=[...text.matchAll(/(?:biljettpris|kostnad|pris|entré)\s*:\s*(?:(från)\s+)?(\d+(?:[,.]\d{1,2})?)\s*(?:kr|SEK|:-)/giu)];
  if(labelled.length===1) {
    const amount=Number(labelled[0][2].replace(',','.'));
    if(amount===0)return {priceType:'free',priceAmount:null};
    return {priceType:labelled[0][1]?'from':'fixed',priceAmount:amount};
  }
  if(!/\d+\s*(?:kr|SEK|:-)/iu.test(text)&&/fri entré|(?:pris|kostnad)\s*:\s*(?:gratis|kostnadsfritt)/iu.test(text))return {priceType:'free',priceAmount:null};
  return {};
}
export function normalizeLibraryEvent(event,libraries,start,end) {
  if(!event||event.deleted===true||!['PUBLISHED','CANCELLED'].includes(event.status))return {reason:'Ej publicerat eller borttaget'};
  if(!/^[a-f\d-]{36}$/i.test(event.id??''))return {reason:'Saknar säkert ID'};
  const startsAt=new Date(event.startDate),endsAt=new Date(event.endDate);
  if(!Number.isFinite(+startsAt)||!Number.isFinite(+endsAt)||endsAt<=startsAt||!/Z$|[+-]\d\d:\d\d$/.test(event.startDate??'')||!/Z$|[+-]\d\d:\d\d$/.test(event.endDate??''))return {reason:'Otydligt datum eller tid'};
  if(endsAt<start||startsAt>end)return {reason:'Utanför datumintervallet'};
  const venueName=plain(event.location?.value);const municipality=libraries.get(libraryKey(venueName));
  if(!municipality)return {reason:'Bibliotekets kommun saknas eller ligger utanför Östergötland',venue:venueName};
  const title=plain(event.title);if(!title)return {reason:'Saknar titel'};
  const tags=(event.tags??[]).map(plain);const audiences=(event.targetAudiences??[]).map(x=>plain(x.value));
  const category=tags.some(t=>key(t)==='utställning')?'utstallning':audiences.some(x=>/^(?:barn|småbarn)$/iu.test(x))?'familj':tags.some(t=>/^(?:musik|sång)$/iu.test(t))?'musik':'kultur';
  return {item:{id:'gotabiblioteken-'+event.id,title,municipality,venueName,category,
    startsAt:startsAt.toISOString(),endsAt:endsAt.toISOString(),cancelled:event.status==='CANCELLED',
    source:'gotabiblioteken',sourceUrl:site+'/program#/events/'+event.id,...explicitPrice(event.description)}};
}
export async function previewLibraries(now=new Date(),request=fetch) {
  const dateClock=new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Stockholm'});
  const hourClock=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Stockholm',hour:'2-digit',hourCycle:'h23'});
  const day=dateClock.format(now);
  const start=[1,2].map(offset=>new Date(Date.parse(day+'T00:00:00Z')-offset*3600000)).find(date=>dateClock.format(date)===day&&hourClock.format(date)==='00');
  if(!start)throw new Error('Svensk midnatt kunde inte beräknas.');
  const end=new Date(+now+90*86400000);
  const [config,directory]=await Promise.all([calendarConfig(request),fetchPublic(site+'/v%C3%A5ra-bibliotek',request).then(r=>r.text())]);
  const libraries=libraryMunicipalities(directory);
  const items=[],rejected={},unknownVenues=new Set(),seen=new Set();let total=0,pages=0;
  for(let offset=0;offset<2000;) {
    const url=new URL(config.calendarApiEndpoint+'/customers/'+config.customerId+'/search');
    url.search=new URLSearchParams({queryString:'event.title:* OR event.description:* OR event.location.value:*',
      rangeFilters:JSON.stringify([{field:'event.endDate',gte:start.toISOString()},{field:'event.startDate',lte:end.toISOString()}]),
      termFilters:JSON.stringify([{field:'event.status',values:['PUBLISHED','CANCELLED']},{type:'NOT_IN',field:'event.deleted',values:[true]}]),
      sorts:JSON.stringify([{field:'event.startDate',order:'ASC'}]),start:String(offset),size:'100'});
    const response=await fetchPublic(url.href,request);const data=await response.json();pages++;
    if(!Array.isArray(data.hits)||!Number.isInteger(data.totalHits)||data.totalHits<0)throw new Error('Kalenderns svar har ett oväntat format.');
    total=data.totalHits;if(total>2000)throw new Error('Fler än 2000 tillfällen: begränsa intervallet innan import.');
    if(data.hits.length===0&&offset<total)throw new Error('Kalenderns sidindelning avslutades för tidigt.');
    for(const row of data.hits) {
      const event=row.event; // Never use search telemetry, patron data or IP-based coordinates.
      if(seen.has(event?.id))throw new Error('Kalendern upprepade ett ID mellan sidor. Kör om förhandsgranskningen.');
      if(event?.id)seen.add(event.id);
      const result=normalizeLibraryEvent(event,libraries,start,end);
      if(result.item)items.push(result.item);
      else {rejected[result.reason]=(rejected[result.reason]??0)+1;if(result.venue)unknownVenues.add(result.venue);}
    }
    offset+=data.hits.length;
    if(offset>=total)break;
  }
  return {generatedAt:now.toISOString(),until:end.toISOString(),source:'Götabiblioteken',readOnly:true,total,pages,libraries:libraries.size,accepted:items.length,rejected,unknownVenues:[...unknownVenues],items};
}
export async function upcomingGotaEvents(now=new Date(),request=fetch) {
  const result=await previewLibraries(now,request);
  console.log('Götabiblioteken: läste',result.total,'kalendertillfällen på',result.pages,'API-sidor; godkände',result.accepted,'i Östergötland.');
  if(Object.keys(result.rejected).length)console.log('Götabiblioteken, bortsorterade:',result.rejected);
  return result.items.map(item=>({...item,startsAt:new Date(item.startsAt),endsAt:new Date(item.endsAt),
    description:'Biblioteksaktivitet. Se bibliotekets egen programsida för innehåll, eventuell anmälan och praktisk information.',
    ...(item.category==='utstallning'?{eventType:'exhibition',dateOnly:true,exhibitionHours:'Se bibliotekets aktuella öppettider och programsida.'}:{dateOnly:false})}));
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===resolve(process.argv[1])) {
  try {
    const result=await previewLibraries();
    const municipalities={};for(const item of result.items)municipalities[item.municipality]=(municipalities[item.municipality]??0)+1;
    console.log('Götabiblioteken – FÖRHANDSGRANSKNING, inga databasändringar.');
    console.log('Kalenderträffar:',result.total,'· API-sidor:',result.pages,'· bibliotek med verifierad kommun:',result.libraries);
    console.log('Godkända tillfällen:',result.accepted,'· giltiga återkommande tillfällen är redan separata poster från källan.');
    console.table(municipalities);console.log('Bortsorterade:',result.rejected);
    if(result.unknownVenues.length)console.log('Bibliotek att kontrollera:',result.unknownVenues.join(', '));
    console.table(result.items.slice(0,20).map(x=>({title:x.title,municipality:x.municipality,venue:x.venueName,startsAt:x.startsAt,cancelled:x.cancelled})));
    await writeFile('gota-preview.json',JSON.stringify(result,null,2));
    console.log('Sparade rapporten gota-preview.json. Inga evenemang har importerats.');
  }catch(error){console.error('Förhandsgranskningen avbröts:',error.message);process.exitCode=1;}
}
