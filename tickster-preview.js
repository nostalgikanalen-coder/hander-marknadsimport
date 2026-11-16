import {cert, initializeApp} from 'firebase-admin/app';
import {getFirestore, Timestamp} from 'firebase-admin/firestore';

const towns = ['Norrköping','Linköping','Motala','Mjölby'];
const base = 'https://www.tickster.com';
const day = new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Stockholm'});
const today = day.format(new Date());
const normalize = value => String(value ?? '').toLocaleLowerCase('sv').replace(/[^\p{L}\p{N}]+/gu,' ').trim();
const plain = html => html.replace(/<[^>]*>/g,' ').replace(/&#(\d+);/g,(_,n)=>String.fromCodePoint(Math.min(Number(n),0x10ffff)))
  .replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&nbsp;/g,' ').replace(/\s+/g,' ').trim();
async function read(url) {
  const response = await fetch(url,{signal:AbortSignal.timeout(12000)});
  if (!response.ok) throw new Error('HTTP '+response.status);
  return response.text();
}

let existing = [];
if (process.env.FIREBASE_SERVICE_ACCOUNT) {
  const db = getFirestore(initializeApp({credential:cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT))}));
  existing = (await db.collection('events').where('startsAt','>=',Timestamp.fromDate(new Date(today+'T00:00:00+02:00')))
    .select('title','municipality','startsAt','hidden').get()).docs.map(doc=>doc.data()).filter(item=>!item.hidden);
} else console.log('Firestore-jämförelse saknas. Ingen tjänstkontonyckel angavs.');

for (const town of towns) {
  try {
    const html = await read(base+'/se/sv/events/in/'+encodeURIComponent(town.toLowerCase()));
    const links = new Map();
    for (const [,path,date,label] of html.matchAll(/href=["'](?:https:\/\/www\.tickster\.com)?(\/se\/sv\/events\/[a-z0-9]+\/(\d{4}-\d{2}-\d{2})\/[^"'?#]+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
      if (date >= today) links.set(path,{date,title:plain(label)});
    }
    console.log(town, links.size,'kommande länkar på första sidan. Kontrollerar högst 8.');
    for (const [path,item] of [...links].slice(0,8)) {
      try {
        const html = await read(base+path);
        const title = plain(html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ?? item.title);
        const venue = plain(html.match(/<a\b[^>]*href=["'][^"']*\/events\/at\/[^"']+["'][^>]*>([\s\S]*?)<\/a>/i)?.[1] ?? '');
        const text = plain(html.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi,''));
        const time = text.match(/\bStartar\s+(?:\d{1,2}\s+[\p{L}.]+\s+)?(\d{1,2}:\d{2})\b/iu)?.[1];
        const comparison = existing.filter(event => normalize(event.municipality) === normalize(town)
          && day.format(event.startsAt.toDate()) === item.date
          && normalize(event.title) === normalize(title));
        console.log(JSON.stringify({town,title,date:item.date,time:time ?? null,venue:venue || null,
          url:base+path,possibleDuplicates:comparison.map(event=>event.startsAt.toDate().toISOString())}));
      } catch(error) { console.warn(base+path,error.message); }
    }
  } catch(error) {
    console.error(town,error.message);
    process.exitCode = 1;
  }
}
