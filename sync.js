import { cert, initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { readFeed, upcomingMarkets } from './calendar.js';

const markets = upcomingMarkets(await readFeed());
if (process.argv.includes('--preview')) {
  console.table(markets.map(({title,startsAt,venueName})=>({title,startsAt,venueName})));
} else {
  if (!process.env.FIREBASE_SERVICE_ACCOUNT) throw new Error('GitHub-hemligheten FIREBASE_SERVICE_ACCOUNT saknas.');
  const account = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  const projectId = 'hander-ostergotland';
  if (account.project_id !== projectId) throw new Error('Tjänstkontot tillhör fel projekt.');
  const db = getFirestore(initializeApp({projectId,credential:cert(account)}));
  for (let offset=0; offset<markets.length; offset+=400) {
    const batch = db.batch();
    for (const {id,...market} of markets.slice(offset,offset+400)) {
      batch.set(db.collection('events').doc(id),{...market,updatedAt:FieldValue.serverTimestamp()},{merge:true});
    }
    await batch.commit();
  }
  console.log('Importerade evenemang:',markets.length);
}
