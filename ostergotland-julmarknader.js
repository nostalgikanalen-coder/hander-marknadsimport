// Dates from the supplied 2026 NT list. Times are included when checked separately.
const guide = slug => 'https://www.julmarknad.nu/event/'+slug+'/';
const visit = slug => 'https://visitlinkoping.se/evenemang/'+slug+'/';
const localDate = new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Stockholm'});

// Markets already maintained by Visit Norrköping or the Linköping import are omitted here.
const markets = [
  ['hjarta','Julmarknad Hjärta till Hjärta','Linköping','Hjärta till Hjärta',visit('julmarknad-hjarta-till-hjarta'),'11-14'],
  ['wallmokrans','Julmarknad hos Wallmokrans','Finspång','Wallmokrans, Ljusfallshammar',guide('wallmokrans-julmarknad'),'11-20 11-21 11-22'],
  ['kornettgarden','Julmarknad på Kornettgården','Linköping','Kornettgården, Vreta Kloster',visit('julmarknad-pa-kornettgarden'),'11-20@10:00 11-21@10:00 11-22@10:00'],
  ['bondens','Bondens julmarknad','Linköping','Yttre Borggården',visit('bondens-marknad-julmarknad'),'11-21@09:30 12-19@09:30'],
  ['hunnebergsgardarna','Julmarknad vid Hunnebergsgårdarna','Linköping','Hunnebergsgårdarna',guide('julmarknad-hunnebergsgardarna'),'11-21'],
  ['fornasa','Julmarknad i Fornåsa','Motala','Hembygdsgården Fornåsdal','https://motalasjostad.se/artikel/julmarknader-i-motala-2026/','11-21@14:00'],
  ['haddorp','Julmarknad på Haddorps gård','Linköping','Haddorps gård','https://www.haddorpsgard.se/julmarknad','11-21 11-22'],
  ['stens-hus','Julmarknad på Stens Hus','Norrköping','Stens Hus, Åby',guide('julmarknad-stens-hus'),'11-21 11-22'],
  ['landeryd','Julmarknad i Landeryds hembygdspark','Linköping','Landeryds hembygdspark',guide('julmarknad-landeryds-hembygdspark'),'11-22'],
  ['vaster-om-stan','Jul väster om stan','Linköping','Flera platser väster om Linköping',visit('jul-hos-vaster-om-stan'),'11-22'],
  ['equmenia','Julmarknad i Equmeniakyrkan','Linköping','Equmeniakyrkan',visit('julmarknad-i-equmeniakyrkan'),'11-27'],
  ['vadstena','Gammeljul på Vadstena slott','Vadstena','Vadstena slott','https://vadstenaslott.com/event_konsert/gammeljul/','11-27@11:00 11-28@11:00 11-29@11:00'],
  ['skarblacka','Julmarknad på torget i Skärblacka','Norrköping','Torget, Skärblacka',guide('julmarknad-torget-skarblacka'),'11-28'],
  ['gryt','Julmarknad i Gryt','Valdemarsvik','Gryt',guide('julmarknad-gryt'),'11-28'],
  ['soderkoping','Söderköpings adventsmarknad','Söderköping','Stadskärnan och Söderköpings Brunn','https://www.soderkoping.se/turism/evenemang/soderkopings-adventsmarknad/','11-28@10:00 11-29@10:00'],
  ['sjostadsjul','Sjöstadsjul på Stora torget','Motala','Stora torget','https://motalasjostad.se/artikel/julmarknader-i-motala-2026/','11-29@11:00'],
  ['sorby','Östgöta julmarknad på Sörby säteri','Linköping','Sörby säteri',guide('ostgota-julmarknad-sorby-sateri'),'11-29'],
  ['motala-folkets-hus','Julmarknad i Folkets Hus','Motala','Folkets Hus','https://motalasjostad.se/artikel/julmarknader-i-motala-2026/','11-29@10:00'],
  ['vanga','Julmarknad vid Vånga hembygdsgård','Norrköping','Vånga hembygdsgård',guide('julmarknad-vanga-hembygdsgard'),'11-29'],
  ['motala-hamn','Julmarknad i Motala hamn','Motala','Motala hamn','https://motalasjostad.se/artikel/julmarknader-i-motala-2026/','11-29@11:00'],
  ['johannelund','Julmarknad på torget i Johannelund','Linköping','Johannelunds torg',guide('julmarknad-johannelund'),'11-29'],
  ['brunneby','Julmarknad på Brunneby musteri','Motala','Brunneby musteri, Borensberg','https://www.brunnebymusteri.se/evenemang/julmarknad-pa-brunneby-3-6-12/','12-03@10:00 12-04@10:00 12-05@10:00 12-06@10:00'],
  ['akerby','Julmarknad på Åkerby gårdsbutik','Norrköping','Åkerby gårdsbutik, Kimstad',guide('julmarknad-akerbys-gardsbutik'),'12-05'],
  ['ekebyborna','Julmarknad i Ekebyborna','Motala','Ekebyborna 365','https://motalasjostad.se/artikel/julmarknader-i-motala-2026/','12-05@10:00'],
  ['vikingstad','Julmarknad i Vikingstads hembygdsgård','Linköping','Vikingstads hembygdsgård',guide('julmarknad-vikingstads-hembygdsgard'),'12-05'],
  ['bomtorpet','Julmarknad i Bomtorpet','Linköping','Bomtorpet, Sturefors',visit('julmarknad-i-bomtorpet'),'12-05'],
  ['medevi','Julmarknad på Medevi Brunn','Motala','Medevi Brunn','https://motalasjostad.se/artikel/julmarknader-i-motala-2026/','12-05@11:00 12-06@11:00'],
  ['bersbo','Bersbo julmarknad','Åtvidaberg','Bersbo','https://tadigut.nu/julmarknad/marknad/bersbo-julmarknad-33333/','12-06@10:00'],
  ['reijmyre','Julmarknad vid Reijmyre Glasbruk','Finspång','Reijmyre Glasbruk','https://tadigut.nu/julmarknad/marknad/julmarknad-vid-reijmyre-glasbruk-33503/','12-12@10:00'],
  ['boxholm','Julmarknad i Boxholm','Boxholm','Storgatan','https://tadigut.nu/julmarknad/marknad/julmarknad-i-boxholm-33331/','12-12@15:00'],
  ['stadsmission','Julmarknad hos Linköpings Stadsmission','Linköping','Linköpings Stadsmission',guide('julmarknad-linkopings-stadsmission'),'12-12'],
  ['ljungs-slott','Adventsmys på Ljungs slott','Linköping','Ljungs slott',visit('adventsmys-pa-ljungs-slott-4'),'12-12'],
  ['ulrika','Gammaldags julrunda i Ulrika','Linköping','Ulrika',visit('gammeldags-julrunda-i-ulrika'),'12-12']
];

export function countyChristmasMarkets(now = new Date()) {
  const today = localDate.format(now);
  return markets.flatMap(([key,title,municipality,venueName,sourceUrl,dates])=>
    dates.split(' ').flatMap(value=>{
      const [shortDay,time] = value.split('@');
      const day = '2026-'+shortDay;
      if (day < today) return [];
      return [{
        id:'julmarknad-ostergotland-'+key+'-'+day,title,municipality,venueName,sourceUrl,
        startsAt:new Date(day+'T'+(time || '00:00')+':00+01:00'),
        dateOnly:!time,category:'julmarknad',source:'julmarknader-ostergotland-2026'
      }];
    })
  );
}
