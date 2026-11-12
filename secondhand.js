const myrorna = 'https://www.myrorna.se/butiker/norrkoping/norrkoping-gamla-radstugugatan/';
const erikshjalpen = 'https://erikshjalpen.se/butiker/second-hand-norrkoping/';
const stadsmissionen = 'https://stadsmissionenost.se/second-hand';

function plain(html = '') {
  const entities = {nbsp:' ',amp:'&',ndash:'–',mdash:'—',aring:'å',auml:'ä',ouml:'ö',Aring:'Å',Auml:'Ä',Ouml:'Ö'};
  return html.replace(/<[^>]+>/g,'').replace(/&(#\d+|[a-z]+);/gi,(entity,key) => {
    if (key.startsWith('#') && Number(key.slice(1)) <= 0x10ffff) return String.fromCodePoint(Number(key.slice(1)));
    return Object.hasOwn(entities,key) ? entities[key] : entity;
  }).replace(/\s+/g,' ').trim();
}

function place(id,title,address,openingHours,sourceUrl) {
  if (!address) throw new Error('Butiksadressen kunde inte läsas för ' + title);
  return {id,title,address,openingHours,sourceUrl,municipality:'Norrköping',category:'secondhand',source:'butikernas-webbplatser'};
}

function parseMyrorna(html) {
  const address = plain(html.match(/<h2>Adress<\/h2>\s*<p>\s*<a[^>]*>([^<]+)/)?.[1]).replace(/,\s*Norrköping$/i,'');
  const hours = html.match(/<ul[^>]*store-content__opening-hours--regular[^>]*>([\s\S]*?)<\/ul>/)?.[1] ?? '';
  const openingHours = [...hours.matchAll(/<li>([\s\S]*?)<\/li>/g)].map(([,row])=>plain(row)).join(' · ');
  return [place('secondhand-myrorna-norrkoping','Myrorna',address,openingHours,myrorna)];
}

function parseErikshjalpen(html) {
  const address = plain(html.match(/<span class="d-block">([^<]+)<\/span>\s*<span class="d-block">\s*\d{3}\s*\d{2}\s+Norrköping\s*<\/span>/i)?.[1]);
  return [place('secondhand-erikshjalpen-norrkoping','Erikshjälpen Second Hand',address,'',erikshjalpen)];
}

function parseStadsmissionen(html) {
  const shops = [['mirum','Mirum Galleria'],['spiralen','Spiralen']];
  const places = [];
  for (const [id,name] of shops) {
    const title = 'Stadsmissionens Second Hand ' + name;
    const pattern = new RegExp('<strong>' + title + '</strong><br\\s*/?>\\s*([^<]+)[\\s\\S]*?</p>\\s*<p><strong>Öppettider[^<]*</strong>([\\s\\S]*?)</p>','i');
    const match = html.match(pattern);
    if (!match) {
      console.warn('Second hand: butiken kunde inte läsas:',name);
      continue;
    }
    const openingHours = match[2].split(/<br\s*\/?>/i).map(plain)
      .filter(value=>/^(måndag|tisdag|onsdag|torsdag|fredag|lördag|söndag)\b/i.test(value)).join(' · ');
    places.push(place('secondhand-stadsmissionen-'+id,title,plain(match[1]),openingHours,stadsmissionen));
  }
  if (!places.length) throw new Error('Stadsmissionens butikssida kunde inte läsas.');
  return places;
}

export async function secondhandPlaces(request = fetch) {
  const sources = [[myrorna,parseMyrorna],[erikshjalpen,parseErikshjalpen],[stadsmissionen,parseStadsmissionen]];
  const results = await Promise.allSettled(sources.map(async ([url,parse]) => {
    const response = await request(url,{signal:AbortSignal.timeout(12000)});
    if (!response.ok) throw new Error('HTTP ' + response.status);
    return parse(await response.text());
  }));
  const places = results.flatMap((result,index) => {
    if (result.status === 'fulfilled') return result.value;
    console.warn('Second hand: hoppade över',new URL(sources[index][0]).hostname,result.reason.message);
    return [];
  });
  if (!places.length) throw new Error('Inga butikssidor kunde läsas.');
  return places;
}
