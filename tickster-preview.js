import {cert, initializeApp} from 'firebase-admin/app';
import {getFirestore, Timestamp} from 'firebase-admin/firestore';

const towns = ['Norrköping','Linköping','Motala','Mjölby'];
const base = 'https://www.tickster.com';
const day = new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Stockholm'});
const localTime = new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Stockholm',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
const today = day.format(new Date());
const normalize = value => String(value ?? '').toLocaleLowerCase('sv').replace(/[^\p{L}\p{N}]+/gu,' ').trim();
const plain = html => html.replace(/<[^>]*>/g,' ').replace(/&#(\d+);/g,(_,n)=>String.fromCodePoint(Math.min(Number(n),0x10ffff)))
  .replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&nbsp;/g,' ').replace(/\s+/g,' ').trim();
async function read(url) {
  const response = await fetch(url,{signal:AbortSignal.timeout(12000)});
  if (!response.ok) throw new Error('HTTP '+response.status);
  return response.text();
}

const apply = process.argv.includes('--apply');
const account = process.env.FIREBASE_SERVICE_ACCOUNT;
if (!account) throw new Error('GitHub-hemligheten FIREBASE_SERVICE_ACCOUNT saknas.');
const db = getFirestore(initializeApp({credential:cert(JSON.parse(account))}));
const events = db.collection('events');
const existing = (await events.where('startsAt','>=',Timestamp.fromMillis(Date.parse(today+'T00:00Z') - 7200000))
  .select('title','municipality','startsAt','venueName').get()).docs.map(doc=>doc.data());
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
    const html = await read(base+'/se/sv/events/in/'+encodeURIComponent(town.toLowerCase()));
    const links = new Map();
    for (const [,path,date,label] of html.matchAll(/href=["'](?:https:\/\/www\.tickster\.com)?(\/se\/sv\/events\/[a-z0-9]+\/(\d{4}-\d{2}-\d{2})\/[^"'?#]+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
      if (date >= today) links.set(path,{date,title:plain(label)});
    }
    console.log(town, links.size,'kommande länkar på första sidan.');
    for (const [path,item] of links) {
      try {
        const html = await read(base+path);
        const title = plain(html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ?? item.title);
        const venue = plain(html.match(/<a\b[^>]*href=["'][^"']*\/events\/at\/[^"']+["'][^>]*>([\s\S]*?)<\/a>/i)?.[1] ?? '');
        const text = plain(html.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi,''));
        const time = text.match(/\bStartar\s+(?:\d{1,2}\s+[\p{L}.]+\s+)?(\d{1,2}:\d{2})\b/iu)?.[1];
        const comparison = existing.filter(event => normalize(event.municipality) === normalize(town)
          && day.format(event.startsAt.toDate()) === item.date
          && normalize(event.title) === normalize(title));
        const candidates = comparison.map(event => ({
          time:localTime.format(event.startsAt.toDate()), venue:event.venueName ?? null
        }));
        const sameSlot = candidates.some(event => event.time === time && venue
          && normalize(event.venue) === normalize(venue));
        const startsAt = time && toLocalTimestamp(item.date,time);
        const result = !startsAt || !venue || !title ? 'uppgifter saknas'
          : sameSlot ? 'möjlig dublett'
          : candidates.length ? 'granska tid eller lokal' : 'ny kandidat';
        if (result === 'ny kandidat') {
          const id = 'tickster-'+path.split('/')[4];
          planned.set(id,{title,municipality:town,venueName:venue,startsAt,
            category:'annat',source:'tickster',sourceUrl:base+path});
        }
        console.log(JSON.stringify({town,title,date:item.date,time:time ?? null,venue:venue || null,
          url:base+path,result,candidates}));
      } catch(error) { console.warn(base+path,error.message); process.exitCode = 1; }
    }
  } catch(error) {
    console.error(town,error.message);
    process.exitCode = 1;
  }
}

console.log('Kandidater efter jämförelse:',planned.size);
if (apply && !process.exitCode && planned.size) {
  const entries = [...planned];
  const added = await db.runTransaction(async transaction => {
    const refs = entries.map(([id]) => events.doc(id));
    const snapshots = await transaction.getAll(...refs);
    let count = 0;
    snapshots.forEach((snapshot,index) => {
      if (snapshot.exists) return;
      transaction.create(refs[index],entries[index][1]);
      count++;
    });
    return count;
  });
  console.log('Skapade:',added);
} else console.log('Inga poster sparades.');
