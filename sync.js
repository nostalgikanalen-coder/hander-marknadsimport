import { cert, initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { readFeed, upcomingMarkets, marketWindowMs } from './calendar.js';

import { upcomingVisitEvents } from './visit-norrkoping.js';
import { secondhandPlaces } from './secondhand.js';
import { countyChristmasMarkets } from './ostergotland-julmarknader.js';
import { linkopingChristmasMarkets } from './linkoping-julmarknader.js';
import { matchMarketDuplicates } from './market-duplicates.js';
import { upcomingArbisConcerts, matchArbisDuplicates } from './arbis.js';

const now = new Date();

const sources = [
  ['Östgötamarknader', 'events', async () => upcomingMarkets(await readFeed(),now), 'ostgotamarknader'],
  ['Visit Norrköping', 'events', upcomingVisitEvents, 'visit-norrkoping'],
  ['Second hand i Norrköping', 'places', secondhandPlaces, 'secondhand'],
  ['Julmarknader i Linköping', 'events', linkopingChristmasMarkets, 'linkoping-julmarknader'],
  ['Julmarknader i Östergötland', 'events', () => countyChristmasMarkets(now), 'ostergotland-julmarknader'],
  ['Arbis', 'events', () => upcomingArbisConcerts(now), 'arbis']
];
const results = await Promise.allSettled(sources.map(([,,load]) => load()));
const duplicates = matchMarketDuplicates(results[0].value ?? [],results[1].value ?? []);
console.log('Matchande loppisdubbletter:',duplicates.size);
const arbisResult = results[sources.findIndex(([, , , id])=>id==='arbis')];
const arbisDuplicates = matchArbisDuplicates(arbisResult.value ?? [],results[1].value ?? []);
console.log('Matchande Arbis-dubbletter:',arbisDuplicates.size);
for (const [id,primary] of arbisDuplicates) duplicates.set(id,primary);
const records = results.flatMap((result,index) => {
  const [name,target] = sources[index];
  if (result.status === 'fulfilled') {
    console.log(name + ':', result.value.length, 'träffar');
    return result.value.filter(entry => !duplicates.has(entry.id)).map(entry => ({target,entry}));
  }
  console.error(name + ':', result.reason.message);
  process.exitCode = 1;
  return [];
});
async function resolveChristmasCategory(db) {
  const collection = db.collection('categories');
  const catalog = await collection.get();
  const canonical = catalog.docs.find(record=>record.id === 'julmarknad');
  if (canonical) return canonical.id;
  const existing = catalog.docs.find(record => {
    const {label,scope,archived} = record.data();
    return !archived && ['events','both'].includes(scope)
      && typeof label === 'string' && /^julmarknader?$/i.test(label.trim());
  });
  if (existing) return existing.id;
  const reference = collection.doc('julmarknad');
  await db.runTransaction(async transaction => {
    if (!(await transaction.get(reference)).exists) {
      transaction.create(reference,{label:'Julmarknader',scope:'events'});
    }
  });
  return reference.id;
}

async function writeImportStatus(db, writeFailed = false) {
  const batch = db.batch();
  for (const [index,[name,,,id]] of sources.entries()) {
    const result = results[index];
    const ok = !writeFailed && result.status === 'fulfilled';
    const lastAttempt = FieldValue.serverTimestamp();
    const status = {name,lastAttempt,state:ok ? 'ok' : 'error'};
    if (ok) Object.assign(status,{lastSuccess:FieldValue.serverTimestamp(),count:result.value.length});
    batch.set(db.collection('importStatus').doc(id),status,{merge:true});
  }
  await batch.commit();
}

if (process.argv.includes('--preview')) {
  console.table(records.map(({target,entry})=>({target,title:entry.title,startsAt:entry.startsAt,location:entry.venueName || entry.address})));
} else {
  if (!process.env.FIREBASE_SERVICE_ACCOUNT) throw new Error('GitHub-hemligheten FIREBASE_SERVICE_ACCOUNT saknas.');
  const account = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  const projectId = 'hander-ostergotland';
  if (account.project_id !== projectId) throw new Error('Tjänstkontot tillhör fel projekt.');
  const db = getFirestore(initializeApp({projectId,credential:cert(account)}));
  try {
    if (records.some(({entry}) => entry.category === 'julmarknad')) {
      const category = await resolveChristmasCategory(db);
      for (const {entry} of records) {
        if (entry.category === 'julmarknad') entry.category = category;
      }
    }
    const protectedConcerts = new Set();
    if (arbisDuplicates.size) {
      const refs = [...arbisDuplicates.keys()].map(id=>db.collection('events').doc(id));
      const current = await db.getAll(...refs);
      for (const record of current) {
        const entry = record.data();
        if (entry?.importLocked || entry?.hidden) protectedConcerts.add(arbisDuplicates.get(record.id));
      }
    }
    const writable = records.filter(({entry})=>!protectedConcerts.has(entry.id));
    const counts = {events:0,places:0};
    for (let offset=0; offset<writable.length; offset+=100) {
      const group = writable.slice(offset,offset+100);
      const references = group.map(({target,entry})=>db.collection(target).doc(entry.id));
      const written = await db.runTransaction(async transaction => {
        const existing = await transaction.getAll(...references);
        const updated = [];
        for (const [index,{target,entry:{id,...entry}}] of group.entries()) {
          const current = existing[index].data();
          if (current?.importLocked === true || current?.hidden === true) continue;
          transaction.set(references[index],{...entry,updatedAt:FieldValue.serverTimestamp()},{merge:true});
          updated.push(target);
        }
        return updated;
      });
      for (const target of written) counts[target]++;
    }
    const staleIds = new Set(duplicates.keys());
    if (results[0].status === 'fulfilled') {
      const currentIds = new Set(results[0].value.map(event=>event.id));
      const future = await db.collection('events').where('startsAt','>=',now)
        .where('startsAt','<',new Date(now.getTime()+marketWindowMs)).get();
      for (const record of future.docs) {
        const event = record.data();
        if (event.source === 'ostgotamarknader' && event.recurringMarket && !currentIds.has(record.id)) staleIds.add(record.id);
      }
    }
    const removals = [...staleIds];
    for (let offset=0; offset<removals.length; offset+=100) {
      const refs = removals.slice(offset,offset+100).map(id=>db.collection('events').doc(id));
      await db.runTransaction(async transaction => {
        for (const record of await transaction.getAll(...refs)) {
          const item = record.data();
          if (item && !item.importLocked && !item.hidden
            && (item.source === 'visit-norrkoping' || (item.source === 'ostgotamarknader' && item.recurringMarket))) {
            transaction.delete(record.ref);
          }
        }
      });
    }
    console.log('Importerade evenemang:',counts.events);
    console.log('Importerade platser:',counts.places);
  } catch (error) {
    try { await writeImportStatus(db,true); }
    catch { console.error('Importstatus kunde inte sparas.'); }
    throw error;
  }
  await writeImportStatus(db);
}
