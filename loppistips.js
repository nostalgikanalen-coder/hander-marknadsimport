import { pathToFileURL } from 'node:url';

const months = 'januari februari mars april maj juni juli augusti september oktober november december'.split(' ');
const shortMonths = 'jan feb mar apr maj jun jul aug sep okt nov dec'.split(' ');
const englishMonths = 'january february march april may june july august september october november december'.split(' ');
const queries = [
  'loppis OR bakluckeloppis Norrköping kommande datum',
  'loppis OR bakluckeloppis (Krokek OR Kolmården OR Vikbolandet OR Skärblacka OR Åby)',
  'marknad OR julmarknad OR fyndmässa (Norrköping OR Krokek OR Kolmården OR Vikbolandet) datum',
  'site:facebook.com/events (loppis OR bakluckeloppis OR marknad) Norrköping'
];
const excludedHosts = ['instagram.com','tiktok.com','pinterest.com'];
const localArea = /norrköping|ljura|krokek|kolmården|vikbolandet|skärblacka|kimstad|norsholm|svärtinge|östra husby|dagsbergsvägen/i;
const eventKind = /loppis|fyndmässa|marknad/i;
const stockholmDay = new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Stockholm'});
const expiryDays = 90;

function makeDay(year,month,day) {
  if (month < 1 || month > 12 || day < 1 || day > 31) return '';
  const date = new Date(Date.UTC(year,month-1,day));
  return date.getUTCMonth() === month-1 && date.getUTCDate() === day ? date.toISOString().slice(0,10) : '';
}
function monthNumber(name) {
  const month = name.toLowerCase();
  const index = [months,shortMonths,englishMonths,englishMonths.map(value=>value.slice(0,3))]
    .map(list=>list.indexOf(month)).find(value=>value >= 0);
  return index === undefined ? 0 : index+1;
}

export function candidateFromResult(result, today, limit, reject = () => {}) {
  const skip = reason => { reject(reason); return null; };
  let url;
  try { url = new URL(result.link); } catch { return skip('saknar användbar länk'); }
  const host = url.hostname.toLowerCase().replace(/^www\./,'');
  if (url.protocol !== 'https:' || !host.includes('.') || url.username || url.password
    || excludedHosts.some(domain=>host === domain || host.endsWith('.'+domain))) return skip('länken är utanför tillåtna källor');
  const facebook = host === 'facebook.com' || host.endsWith('.facebook.com');
  const facebookId = facebook ? url.pathname.match(/^\/events\/(?:[^/]+\/)*(\d{5,})\/?$/)?.[1] : null;
  if (facebook && !facebookId) return skip('länken går inte till ett Facebook-evenemang');
  const title = String(result.title ?? '').trim().slice(0,160);
  const snippet = String(result.snippet ?? '').split(/suggested events|föreslagna evenemang/i)[0];
  const context = title + ' ' + snippet;
  if (!eventKind.test(title)) return skip('titeln anger ingen loppis eller marknad');
  if (!localArea.test(context) || /\btrosa\b/i.test(context)) return skip('platsen kunde inte bekräftas i Norrköping');
  if (/\binställ[dt]\b|\buppskjut[et]n?\b/i.test(context)) return skip('verkar vara inställt eller uppskjutet');
  if (/\d{1,2}\s*[–—-]\s*\d{1,2}\s+[a-zåäö]{3,}/i.test(context)) return skip('flera dagar i samma datumintervall');
  const dates = new Set();
  for (const [,day,month,year] of context.matchAll(/\b(\d{1,2})\s+([a-zåäö]{3,9})\.?\s+(20\d{2})\b/gi)) {
    const value = makeDay(Number(year),monthNumber(month),Number(day));
    if (value) dates.add(value);
  }
  for (const [,month,day,year] of title.matchAll(/\bon\s+([a-z]{3,9})\s+(\d{1,2}),\s*(20\d{2})\b/gi)) {
    const value = makeDay(Number(year),monthNumber(month),Number(day));
    if (value) dates.add(value);
  }
  for (const [,year,month,day] of context.matchAll(/\b(20\d{2})-(\d{2})-(\d{2})\b/g)) {
    const value = makeDay(Number(year),Number(month),Number(day));
    if (value) dates.add(value);
  }
  for (const [,day,month,year] of context.matchAll(/\b(\d{1,2})[/.](\d{1,2})[/.–-](20\d{2})\b/g)) {
    const value = makeDay(Number(year),Number(month),Number(day));
    if (value) dates.add(value);
  }
  if (!dates.size) return skip('saknar ett läsbart datum med år');
  if (dates.size > 1) return skip('flera möjliga datum');
  const [day] = dates;
  if (day < today) return skip('datumet har passerat: '+day);
  if (day > limit) return skip('datumet ligger längre än 90 dagar fram: '+day);
  if (facebookId) return {title,day,url:'https://www.facebook.com/events/'+facebookId+'/'};
  url.hash = '';
  for (const key of [...url.searchParams.keys()]) {
    if (key.startsWith('utm_') || ['fbclid','gclid'].includes(key)) url.searchParams.delete(key);
  }
  return {title,day,url:url.href};
}

export async function searchCandidates(key, now = new Date(), request = fetch, preview = false) {
  const today = stockholmDay.format(now);
  const limit = stockholmDay.format(new Date(now.getTime()+expiryDays*86400000));
  const found = new Map();
  for (const query of queries) {
    const response = await request('https://google.serper.dev/search',{
      method:'POST',
      headers:{'X-API-KEY':key,'Content-Type':'application/json'},
      body:JSON.stringify({q:query,gl:'se',hl:'sv',tbs:'qdr:m'}),
      signal:AbortSignal.timeout(15000)
    });
    if (!response.ok) throw new Error('Serper svarade med HTTP '+response.status);
    const payload = await response.json();
    if (payload.error) throw new Error('Serper rapporterade ett fel.');
    const results = Array.isArray(payload.organic) ? payload.organic : [];
    const skipped = [];
    const accepted = results.map(result=>candidateFromResult(result,today,limit,reason=>{
      skipped.push({reason,title:String(result.title ?? '').slice(0,160),snippet:String(result.snippet ?? '').slice(0,240)});
    })).filter(Boolean);
    for (const entry of accepted) found.set(entry.url+'|'+entry.day,entry);
    console.log('Sökning:',query,'| Träffar:',results.length,'| Klarade filtret:',accepted.length);
    if (preview && skipped.length) {
      const counts = new Map();
      for (const {reason} of skipped) counts.set(reason,(counts.get(reason) ?? 0)+1);
      console.log('Bortsorterade:',JSON.stringify(Object.fromEntries(counts)));
      for (const item of skipped.slice(0,3)) console.log('Exempel:',JSON.stringify(item));
    }
  }
  return [...found.values()];
}

async function main() {
  const key = process.env.SERPER_KEY?.trim();
  if (!key) throw new Error('GitHub-hemligheten SERPER_KEY eller SERPAPI_KEY saknas.');
  const preview = process.argv.includes('--preview');
  const candidates = await searchCandidates(key,new Date(),fetch,preview);
  console.log('Loppiskandidater med framtida datum:',candidates.length);
  for (const candidate of candidates) console.log(JSON.stringify(candidate));
  if (preview || !candidates.length) return;

  const {createHash} = await import('node:crypto');
  const {cert,initializeApp} = await import('firebase-admin/app');
  const {getFirestore,FieldValue} = await import('firebase-admin/firestore');
  if (!process.env.FIREBASE_SERVICE_ACCOUNT) throw new Error('GitHub-hemligheten FIREBASE_SERVICE_ACCOUNT saknas.');
  const account = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  const projectId = 'hander-ostergotland';
  if (account.project_id !== projectId) throw new Error('Tjänstkontot tillhör fel projekt.');
  const db = getFirestore(initializeApp({projectId,credential:cert(account)}));
  let created = 0;
  for (const item of candidates) {
    const id = 'serper-' + createHash('sha256').update(item.url+'|'+item.day).digest('hex').slice(0,32);
    const receipt = db.collection('loppisSearchSeen').doc(id);
    const tip = db.collection('eventTips').doc(id);
    const added = await db.runTransaction(async transaction => {
      if ((await transaction.get(receipt)).exists) return false;
      transaction.create(receipt,{seenAt:FieldValue.serverTimestamp()});
      transaction.create(tip,{
        title:item.title, municipality:'Norrköping', category:'loppis',
        sourceUrl:item.url, venueName:'', candidateDate:item.day,
        description:'Sökträffen nämner '+item.day+'. Bekräfta datum, tid och plats hos arrangören och ersätt den här texten före publicering.',
        source:'serper', submittedAt:FieldValue.serverTimestamp()
      });
      return true;
    });
    if (added) created++;
  }
  console.log('Nya tips att granska:',created);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error('Loppissökningen misslyckades:',error.message);
    process.exitCode = 1;
  });
}
