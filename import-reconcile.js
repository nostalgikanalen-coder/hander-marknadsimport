// Match conservatively across sources, retaining the existing Firestore document ID.
const day=new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Stockholm'});
const normal=value=>String(value??'').normalize('NFC').toLocaleLowerCase('sv').replace(/[^\p{L}\p{N}]+/gu,' ').trim();
const direct=new Set(['louis-de-geer','arbetets-museum']);
function date(value) {return value?.toDate?value.toDate():new Date(value);}
function place(value,registry) {
  const key=normal(value).replace(/ norrköping$/u,'');
  if(['de geerhallen','louis de geer','louis de geer konsert kongress','louis de geer konsert och kongress'].includes(key))return 'de geerhallen';
  for(const venue of registry) {
    if([venue.name,...(venue.aliases??[])].some(name=>normal(name)===key))return normal(venue.name);
  }
  return key;
}
function same(a,b,registry) {
  if(normal(a.municipality)!==normal(b.municipality))return false;
  const ad=date(a.startsAt),bd=date(b.startsAt);
  if(!Number.isFinite(+ad)||!Number.isFinite(+bd))return false;
  // Exact source link can also identify a changed start time; only for individual event pages.
  if(a.sourceUrl&&a.sourceUrl.replace(/\/$/,'')===b.sourceUrl?.replace(/\/$/,''))return true;
  if(place(a.venueName,registry)!==place(b.venueName,registry))return false;
  if(/^julmarknad(?:er)?$/.test(a.category??'')&&/^julmarknad(?:er)?$/.test(b.category??'')) {
    const ae=date(a.endsAt??a.startsAt),be=date(b.endsAt??b.startsAt);
    return day.format(ad)<=day.format(be)&&day.format(bd)<=day.format(ae);
  }
  if(normal(a.title)!==normal(b.title))return false;
  if(a.dateOnly===true&&b.dateOnly===true)return day.format(ad)===day.format(bd);
  return a.dateOnly!==true&&b.dateOnly!==true&&+ad===+bd;
}
export function reconcileDirectSources(records,existing=[],registry=[]) {
  const candidates=records.filter(r=>r.target==='events'&&direct.has(r.entry.source));
  const rest=records.filter(r=>!candidates.includes(r));
  const output=[];let matched=0,protectedCount=0;
  for(const record of candidates) {
    const entry=record.entry;
    const matches=existing.filter(old=>old.id===entry.id||same(entry,old,registry));
    const own=matches.find(old=>old.id===entry.id);
    // Ambiguous matches are skipped rather than creating an additional duplicate.
    if(matches.length>1&&!own){protectedCount++;continue;}
    const current=own??matches[0];
    if(current&&(current.importLocked||current.hidden||!current.source)){protectedCount++;continue;}
    const inRun=rest.filter(r=>r.target==='events'&&same(entry,r.entry,registry));
    if(!current&&inRun.length>1){protectedCount++;continue;}
    const primary=current??inRun[0]?.entry;
    if(primary) {
      matched++;
      // Preserve source identity so existing cancellation/dedup jobs still recognize the record.
      record.entry={...entry,id:primary.id,source:primary.source??entry.source};
      // Broad categories and generic text must not replace more specific existing information.
      for(const key of ['category','description','address','latitude','longitude','imageUrl']) {
        if(primary[key]!==undefined && (key==='category'&&entry.category==='kultur'||key==='description'||entry[key]===undefined))record.entry[key]=primary[key];
      }
      if(primary.cancelled===true)record.entry.cancelled=true;
    }
    for(let i=rest.length-1;i>=0;i--)if(rest[i].target==='events'&&(rest[i].entry.id===record.entry.id||same(entry,rest[i].entry,registry)))rest.splice(i,1);
    output.push(record);
  }
  return {records:[...rest,...output],matched,protectedCount};
}

export function sameImportedFields(current,entry) {
  const normalize=value=>value instanceof Date ? +value : value?.toMillis ? value.toMillis() : value;
  return Object.entries(entry).every(([key,value])=>JSON.stringify(normalize(current[key]))===JSON.stringify(normalize(value)));
}
