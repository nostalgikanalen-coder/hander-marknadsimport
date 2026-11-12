import { cert, initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { readFeed, upcomingMarkets } from './calendar.js';

import { upcomingVisitEvents } from './visit-norrkoping.js';
import { secondhandPlaces } from './secondhand.js';

const sources = [
  ['Östgötamarknader', 'events', async () => upcomingMarkets(await readFeed())],
  ['Visit Norrköping', 'events', upcomingVisitEvents],
  ['Second hand i Norrköping', 'places', secondhandPlaces]
];
const results = await Promise.allSettled(sources.map(([,,load]) => load()));
const records = results.flatMap((result,index) => {
  const [name,target] = sources[index];
  if (result.status === 'fulfilled') {
    console.log(name + ':', result.value.length, 'träffar');
    return result.value.map(entry => ({target,entry}));
  }
  console.error(name + ':', result.reason.message);
  process.exitCode = 1;
  return [];
});
if (process.argv.includes('--preview')) {
  console.table(records.map(({target,entry})=>({target,title:entry.title,startsAt:entry.startsAt,location:entry.venueName || entry.address})));
} else {
  if (!process.env.FIREBASE_SERVICE_ACCOUNT) throw new Error('GitHub-hemligheten FIREBASE_SERVICE_ACCOUNT saknas.');
  const account = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  const projectId = 'hander-ostergotland';
  if (account.project_id !== projectId) throw new Error('Tjänstkontot tillhör fel projekt.');
  const db = getFirestore(initializeApp({projectId,credential:cert(account)}));
  const counts = {events:0,places:0};
  for (let offset=0; offset<records.length; offset+=100) {
    const group = records.slice(offset,offset+100);
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
  console.log('Importerade evenemang:',counts.events);
  console.log('Importerade platser:',counts.places);
}
