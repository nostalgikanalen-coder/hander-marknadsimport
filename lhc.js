const leagues = [['20961','Herrar'],['20960','Damer']];
const clock = new Intl.DateTimeFormat('sv-SE',{
  timeZone:'Europe/Stockholm',dateStyle:'short',timeStyle:'short',hourCycle:'h23'
});

export function parseLhcMatches(html, team, sourceUrl, now) {
  const matches = [];
  let day;
  for (const [row] of html.matchAll(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi)) {
    const cells = [...row.matchAll(/<td\b[^>]*?(?:\/>|>([\s\S]*?)<\/td>)/gi)].map(([,cell])=>
      (cell ?? '').replace(/<[^>]*>/g,' ').replace(/&nbsp;/g,' ').replace(/\s+/g,' ').trim());
    if (/^\d{4}-\d{2}-\d{2}$/.test(cells[0])) day = cells[0];
    const slot = row.match(/<span\b[^>]*class="lnkTooltip"[^>]*title="(\d+)"[^>]*>(\d{2}:\d{2})<\/span>/i);
    const title = cells.find(cell=>/^Linköping HC\s+[-–]\s+\S/i.test(cell));
    if (!day || !slot || !title || cells.at(-1) !== 'Saab Arena') continue;
    const [,id,time] = slot;
    const base = Date.parse(day+'T'+time+':00Z');
    const candidates = [1,2].map(offset=>new Date(base-offset*3600000))
      .filter(date=>Number.isFinite(+date) && clock.format(date).replace(',','')===day+' '+time);
    if (candidates.length !== 1) continue;
    const [startsAt] = candidates;
    if (startsAt < now || +startsAt >= +now+90*86400000) continue;
    matches.push({
      id:'lhc-'+id,title:'Hockey: '+title+' ('+team+')',team,startsAt,
      venueName:'Saab Arena',municipality:'Linköping',category:'sport',source:'lhc',sourceUrl
    });
  }
  return matches;
}

export async function upcomingLhcMatches(now = new Date(),request = fetch) {
  if (now >= new Date('2027-05-01T00:00:00+02:00')) return [];
  const results = await Promise.allSettled(leagues.map(async ([id,team])=>{
    const url = 'https://stats.swehockey.se/ScheduleAndResults/Schedule/'+id;
    const response = await request(url,{signal:AbortSignal.timeout(15000)});
    if (!response.ok) throw new Error(team+' HTTP '+response.status);
    const html = await response.text();
    if (!html.includes('lnkTooltip')) throw new Error(team+': spelschemat kunde inte läsas.');
    return parseLhcMatches(html,team,url,now);
  }));
  if (results.every(result=>result.status==='rejected')) throw new Error('LHC:s spelscheman kunde inte läsas.');
  for (const result of results) if (result.status==='rejected') console.warn('LHC:',result.reason.message);
  return results.flatMap(result=>result.status==='fulfilled' ? result.value : []);
}
