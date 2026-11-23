import {extractPrice,rememberPricePage,enrichPrices} from './event-prices.js';
import {cert, initializeApp} from 'firebase-admin/app';
import {getFirestore, Timestamp, FieldValue} from 'firebase-admin/firestore';

const towns = ['Finspång','Söderköping','Vadstena'];
const base = 'https://www.tickster.com';
const day = new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Stockholm'});
const localTime = new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Stockholm',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
const today = day.format(new Date());
const normalize = value => String(value ?? '').toLocaleLowerCase('sv').replace(/[^\p{L}\p{N}]+/gu,' ').trim();
const plain = html => html.replace(/<[^>]*>/g,' ').replace(/&#(\d+);/g,(_,n)=>String.fromCodePoint(Math.min(Number(n),0x10ffff)))
  .replace(/&#x([a-f0-9]+);/gi,(_,n)=>String.fromCodePoint(Math.min(parseInt(n,16),0x10ffff)))
  .replace(/&auml;/g,'ä').replace(/&ouml;/g,'ö').replace(/&aring;/g,'å')
  .replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&nbsp;/g,' ').replace(/\s+/g,' ').trim();
async function read(url) {
  const response = await fetch(url,{signal:AbortSignal.timeout(12000)});
  if (!response.ok) throw Object.assign(new Error('HTTP '+response.status), {status:response.status});
  const html=await response.text();rememberPricePage(url,html);return html;
}

const apply = false;
const account = process.env.FIREBASE_SERVICE_ACCOUNT;
if (!account) throw new Error('GitHub-hemligheten FIREBASE_SERVICE_ACCOUNT saknas.');
const db = getFirestore(initializeApp({credential:cert(JSON.parse(account))}));
const events = db.collection('events');
const existing = (await events.where('startsAt','>=',Timestamp.fromMillis(Date.parse(today+'T00:00Z') - 7200000))
  .get()).docs.map(doc=>({...doc.data(),id:doc.id}));
function similarTitle(left, right) {
  const words = value => normalize(value).split(' ').filter(word =>
    word.length > 2 && !['with','and','med','the','special','guest','guests','trio'].includes(word));
  const a = [...new Set(words(left))];
  const b = [...new Set(words(right))];
  const shared = a.filter(word => b.includes(word)).length;
  return shared >= 2 && shared / Math.max(a.length,b.length) >= 0.6;
}
function similarVenue(left, right) {
  const a = normalize(left);
  const b = normalize(right);
  return a.length >= 4 && b.length >= 4
    && (a === b || a.startsWith(b+' ') || b.startsWith(a+' '));
}
function isCinemaScreening(title, venue) {
  if (/filmfestival/iu.test(title)) return false;
  return /^(?:bio|dagbio|knattebio|barnbio|seniorbio|skolbio|familjebio)\s*:/iu.test(title.trim())
    || /\b(?:dagbio|knattebio|barnbio|seniorbio|skolbio)\b/iu.test(title)
    || /\bbio(?:graf)?\b/iu.test(venue);
}

function classify(title, venue) {
  const name = normalize(title);
  if (/\b(julmarknad|julmarknader)\b/.test(name)) return 'julmarknad';
  if (/\b(loppis|bakluckeloppis)\b/.test(name)) return 'loppis';
  if (/\b(standup|teater|musikal|workshop|utställning|mässa|retromania|filmfestival)\b/.test(name)) return 'kultur';
  if (/\bteater\b/.test(normalize(venue))) return 'kultur';
  if (/^(dungen)$/.test(name) || /\b(konsert|live|tribute|rock|punk fest|jazz)\b/.test(name)
      || /\b(platens bar|palatset|bomber bar|arbis)\b/.test(normalize(venue))) return 'musik';
  return 'annat';
}
const changes = new Map();
const seen = new Set();
const planned = new Map();
const toLocalTimestamp = (date,time) => {
  const wall = Date.parse(date+'T'+time.padStart(5,'0')+':00Z');
  const matches = [1,2].map(offset => new Date(wall - offset*3600000))
    .filter(value => Number.isFinite(value.getTime()) && day.format(value) === date
      && localTime.format(value) === time.padStart(5,'0'));
  return matches.length === 1 ? Timestamp.fromDate(matches[0]) : null;
};

for (const town of towns) {
  try {
    const cityUrl = new URL('/se/sv/events/in/'+encodeURIComponent(town.toLowerCase()),base);
    const links = new Map();
    const visited = new Set();
    let pageUrl = cityUrl.href;
    let pages = 0;
    while (pageUrl && pages < 3 && !visited.has(pageUrl)) {
      visited.add(pageUrl);
      const html = await read(pageUrl);
      pages++;
      for (const [,path,date,label] of html.matchAll(/href=["'](?:https:\/\/www\.tickster\.com)?(\/se\/sv\/events\/[a-z0-9]+\/(\d{4}-\d{2}-\d{2})\/[^"'?#]+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
        if (date >= today) links.set(path,{date,title:plain(label)});
      }
      let next;
      for (const [,href,label] of html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
        if (plain(label).toLowerCase() !== 'nästa sida') continue;
        const url = new URL(href.replace(/&amp;/g,'&'),pageUrl);
        if (url.origin === base && url.pathname === cityUrl.pathname) next = url.href;
      }
      pageUrl = next;
    }
    console.log(town,links.size,'kommande länkar från',pages,'sidor.');
    for (const current of existing) {
      if (current.source !== 'tickster' || current.municipality !== town || !current.sourceUrl) continue;
      try {
        const url = new URL(current.sourceUrl);
        const match = url.pathname.match(/^\/se\/sv\/events\/([a-z0-9]+)\/(\d{4}-\d{2}-\d{2})\/[^/]+$/i);
        if (url.origin === base && match && current.id === 'tickster-'+match[1]) {
          links.set(url.pathname,{date:match[2],title:current.title});
        }
      } catch {}
    }
    for (const [path,item] of links) {
      try {
        const id = 'tickster-'+path.split('/')[4];
        if (seen.has(id)) continue;
        seen.add(id);
        const html = await read(base+path);
        const title = plain(html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ?? item.title);
        const venue = plain(html.match(/<a\b[^>]*href=["'][^"']*\/events\/at\/[^"']+["'][^>]*>([\s\S]*?)<\/a>/i)?.[1] ?? '');
        if (isCinemaScreening(title,venue)) {
          console.log('Hoppar över biovisning:',town,title);
          continue;
        }
        const text = plain(html.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi,''));
        const months = ['januari','februari','mars','april','maj','juni','juli','augusti','september','oktober','november','december'];
        const dated = text.match(/\bden\s+(\d{1,2})\s+(januari|februari|mars|april|maj|juni|juli|augusti|september|oktober|november|december)\s+(\d{4})/iu);
        const date = dated ? dated[3]+'-'+String(months.indexOf(dated[2].toLowerCase())+1).padStart(2,'0')+'-'+dated[1].padStart(2,'0') : null;
        let cancelled = /\bevenemanget är inställt\b/iu.test(text)
          || /^(?:obs\s+)?inställt\b/iu.test(title.trim());
        if (id === 'tickster-r3jxhurbch9ybhm') {
          const organizerUrl = 'https://louisdegeer.se/evenemang/en-innerlig-jul-med-andreas-aleman-och-tareq-taylor/';
          const organizerText = plain((await read(organizerUrl)).replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi,''));
          const correctEvent = /En innerlig jul/iu.test(organizerText)
            && /19\s+november\s+2026/iu.test(organizerText)
            && /Flygeln/iu.test(organizerText);
          if (correctEvent && /Konserten har ställts in/iu.test(organizerText)) {
            cancelled = true;
            console.log('Inställning bekräftad av arrangören:',organizerUrl);
          }
        }
        const time = text.match(/\bStartar\s+(?:\d{1,2}\s+[\p{L}.]+\s+)?(\d{1,2}:\d{2})\b/iu)?.[1];
        const comparison = existing.filter(event => normalize(event.municipality) === normalize(town)
          && day.format(event.startsAt.toDate()) === (date ?? item.date)
          && (normalize(event.title) === normalize(title)
            || (similarVenue(event.venueName,venue) && similarTitle(event.title,title))));
        const candidates = comparison.map(event => ({
          title:event.title, time:localTime.format(event.startsAt.toDate()), venue:event.venueName ?? null
        }));
        const sameSlot = candidates.some(event => event.time === time && venue
          && normalize(event.title) === normalize(title) && similarVenue(event.venue,venue));
        const startsAt = date && time && toLocalTimestamp(date,time);
        const result = !startsAt || !venue || !title ? 'uppgifter saknas'
          : sameSlot ? 'möjlig dublett'
          : candidates.length ? 'granska titelvariant, tid eller lokal' : 'ny kandidat';
        const category = classify(title,venue);
        const price = startsAt ? extractPrice(html,{title,startsAt,sourceUrl:base+path}) : {};
        if (price.priceType) price.priceSourceUrl=base+path;
        const own = existing.find(event => event.id === id);
        if (own && own.source === 'tickster') {
          if (cancelled) changes.set(id,{cancelled:true});
          else if (startsAt && title && venue) changes.set(id,{title,startsAt,venueName:venue,sourceUrl:base+path,...price,
            ...(own.category === 'annat' && category !== 'annat' ? {category} : {})});
        }
        if (result === 'ny kandidat' && !own) {
          planned.set(id,{title,municipality:town,venueName:venue,startsAt,
            category,cancelled,source:'tickster',sourceUrl:base+path,...price});
        }
        console.log(JSON.stringify({town,title,date:date ?? item.date,time:time ?? null,venue:venue || null,
          url:base+path,category,cancelled,priceType:price.priceType || null,priceAmount:price.priceAmount ?? null,
          result:own ? (own.importLocked || own.hidden ? 'skyddad post' : cancelled ? 'inställt – markeras' : 'befintlig Tickster-post') : cancelled ? 'ny kandidat – inställt' : result,candidates}));
      } catch(error) {
        if ([404,410].includes(error.status)) {
          console.warn('Granska borttagen Tickster-sida:',base+path,'HTTP',error.status);
        } else {
          console.error(base+path,error.message);
          process.exitCode = 1;
        }
      }
    }
  } catch(error) {
    console.error(town,error.message);
    process.exitCode = 1;
  }
}

const priceRecords=[...planned.values()].map(entry=>({target:'events',entry}));
for (const [id,patch] of changes) {
  const current=existing.find(event=>event.id===id);
  if(current && !current.hidden && !current.importLocked)priceRecords.push({target:'events',entry:{...current,...patch,id}});
}
await enrichPrices(priceRecords);
for(const {entry} of priceRecords){
  if(!entry.priceType)continue;
  console.log('Verifierat pris:',JSON.stringify({title:entry.title,priceType:entry.priceType,priceAmount:entry.priceAmount,source:entry.priceSourceUrl}));
  if(changes.has(entry.id))changes.set(entry.id,{...changes.get(entry.id),priceType:entry.priceType,priceAmount:entry.priceAmount,priceSourceUrl:entry.priceSourceUrl || entry.sourceUrl});
}

function different(current, patch) {
  return Object.fromEntries(Object.entries(patch).filter(([key,value]) =>
    key === 'startsAt' ? current.startsAt?.toMillis?.() !== value.toMillis() : current[key] !== value));
}
console.log('Nya kandidater:',planned.size);
for (const [id,patch] of changes) {
  const current = existing.find(event => event.id === id);
  if (current.hidden || current.importLocked) continue;
  const updated = different(current,patch);
  if (Object.keys(updated).length) console.log('Föreslagen uppdatering:',JSON.stringify({
    id,title:current.title,fields:Object.keys(updated),
    oldStart:current.startsAt?.toDate?.().toISOString(),newStart:updated.startsAt?.toDate().toISOString(),
    cancelled:updated.cancelled === true
  }));
}
if (apply && !process.exitCode) {
  const ids = [...new Set([...planned.keys(),...changes.keys()])];
  const counts = {added:0,updated:0,hidden:0,protected:0};
  if (ids.length) Object.assign(counts,await db.runTransaction(async transaction => {
    const refs = ids.map(id => events.doc(id));
    const snapshots = await transaction.getAll(...refs);
    const result = {added:0,updated:0,hidden:0,protected:0};
    snapshots.forEach((snapshot,index) => {
      const id = ids[index];
      const current = snapshot.data();
      if (!snapshot.exists && planned.has(id)) {
        transaction.create(refs[index],{...planned.get(id),createdAt:FieldValue.serverTimestamp(),updatedAt:FieldValue.serverTimestamp()});
        result.added++;
      } else if (current?.source === 'tickster' && changes.has(id)) {
        if (current.hidden || current.importLocked) { result.protected++; return; }
        const patch = {...changes.get(id)};
        if (current.category !== 'annat') delete patch.category;
        if (patch.startsAt && current.endsAt && current.startsAt?.toMillis() !== patch.startsAt.toMillis()) {
          console.log('Granska sluttid före tidsändring:',id);
          return;
        }
        const updated = different(current,patch);
        if (!Object.keys(updated).length) return;
        transaction.update(refs[index],{...updated,updatedAt:FieldValue.serverTimestamp()});
        if (updated.cancelled === true) result.hidden++;
        else result.updated++;
      }
    });
    return result;
  }));
  console.log('Skapade:',counts.added);
  console.log('Uppdaterade:',counts.updated);
  console.log('Markerade som inställda:',counts.hidden);
  console.log('Skyddade manuella poster:',counts.protected);
} else console.log('Inga poster sparades.');
