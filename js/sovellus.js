// Metsästäjä Pron käyttöliittymä: jahdin tallennus, karttamerkinnät, metsästysalueet, saaliit ja havainnot.
// Karttamoottori, tallennus (IndexedDB), lomake, paikannus ja sää ovat tiedostossa pohja.js. Kaikki tieto pysyy tämän laitteen selaimessa.
'use strict';
const nopeus = ms => ms * 3.6;                                        // näytetään aina km/h
const km = m => m < 1000 ? Math.round(m) + ' m' : n(m / 1000, m < 10000 ? 2 : 1) + ' km';
const uusiId = () => 'x' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const tuuliVari = v => v < 4 ? '#1f8a4c' : v < 8 ? '#0b7a8f' : v < 11 ? '#c77700' : v < 14 ? '#e8590c' : '#c0392b';
// Karttamerkintöjen lajit: [nimi, väri, kirjain]
const MERKIT = { passi: ['Passipaikka', '#c0392b', 'P'], torni: ['Ampumatorni tai -lava', '#8e44ad', 'T'], ruokinta: ['Ruokintapaikka', '#1f8a4c', 'R'], nuolukivi: ['Nuolukivi', '#0b7a8f', 'N'],
  kamera: ['Riistakamera', '#34495e', 'K'], jaljet: ['Jäljet tai makuupaikka', '#b26a00', 'J'], auto: ['Auto tai kokoontumispaikka', '#1565c0', 'A'], muu: ['Muu merkintä', '#6b7780', '•'] };
const merkkiAvain = nimi => Object.keys(MERKIT).find(k => MERKIT[k][0] === nimi) || 'muu';
const LAJIT = ['Hirvi', 'Valkohäntäpeura', 'Metsäkauris', 'Kuusipeura', 'Villisika', 'Karhu', 'Metsäjänis', 'Rusakko', 'Kettu', 'Supikoira', 'Mäyrä', 'Näätä', 'Minkki', 'Majava',
  'Metso', 'Teeri', 'Pyy', 'Riekko', 'Fasaani', 'Sepelkyyhky', 'Sinisorsa', 'Tavi', 'Telkkä', 'Metsähanhi', 'Merihanhi', 'Kanadanhanhi', 'Varis', 'Muu'];
function uusiTila() {
  return { as: { kartta: 'topo', mmlAvain: '', seuranta: false, tuuli: false, rajavaroitus: true, merkitKartalla: true, saaliitKartalla: true },
    merkit: [], alueet: [], saaliit: [], paikat: [], saajono: [], kopio: null, sij: null };
}

let T, matkat = [], tal, nakyma = 'kartta', valittu = null, vuosi = String(new Date().getFullYear());
let watchId = null, lukko = null, viimeTalletus = 0, saaKaynnissa = false;
let jalki = null, lk = null, kulku = null, kLive = null, kYksi = null, dv = null;
let napautusCb = null, naytetty = null, piirto = null;      // naytetty = pääkartalla näytettävä vanha jälki, piirto = piirrettävä alue
const lv = { lat: 62.5, lon: 26.0, z: 5.5, seuraa: true, alussa: true };     // päänäkymän kartan tila säilyy välilehteä vaihdettaessa
const gps = { viime: null, virhe: '' };
const talletaT = () => DB.put('kv', T, 'tila');
const vuodelta = (lista, f) => vuosi === 'kaikki' ? lista : lista.filter(x => String(new Date(f(x)).getFullYear()) === vuosi);
const paikkaNyt = () => gps.viime && watchId != null ? [gps.viime.lat, gps.viime.lon] : T.sij || null;
const sogNyt = () => { const f = gps.viime; return !f ? 0 : f.sog != null && !isNaN(f.sog) ? f.sog : tal.viime ? tal.viime.sog || 0 : 0; };

// ---------- jahdin tallennus ----------
function fix(f) {
  gps.viime = f; gps.virhe = '';
  alueTarkista(f);
  tal.syota(f);
  if (tal.tila === 'matka' && f.t - viimeTalletus > 30000) { viimeTalletus = f.t; DB.put('kv', tal.vie(), 'kesken'); }
  paivitaLive();
}
async function tallennaJahti(m) {
  const pts = m.pisteet, a = pts[0], b = pts[pts.length - 1], k = pts[Math.floor(pts.length / 2)];
  const j = { id: 'm' + m.alku, alku: m.alku, loppu: m.loppu, matka: Math.round(m.matka), liike: Math.round(m.liike), max: m.max, katkot: m.katkot,
    a: a ? [a[1], a[2]] : null, b: b ? [b[1], b[2]] : null, k: k ? [k[1], k[2]] : null, nimi: '', huom: '', saa: null, mista: '', minne: '' };
  const al = a && T.alueet.find(x => pisteMonikulmiossa(a[1], a[2], x.p)); if (al) j.nimi = al.nimi;      // jahti nimetään alueen mukaan, jos lähtö oli alueella
  await DB.put('matkat', j); await DB.put('jaljet', pts, j.id); await DB.del('kv', 'kesken');
  matkat = matkat.filter(x => x.id !== j.id); matkat.push(j);
  T.saajono.push(j.id); await talletaT();
  paivitaSaat();
  return j;
}
async function poistaJahdit(idt) {
  for (const id of idt) { await DB.del('matkat', id); await DB.del('jaljet', id); }
  matkat = matkat.filter(m => !idt.includes(m.id)); T.saajono = T.saajono.filter(x => !idt.includes(x)); await talletaT();
}
const jahtiNimi = m => m.nimi || (m.a ? koord(m.a[0], m.a[1]) : 'Jahti');

// ---------- metsästysalueen rajavaroitus ----------
// Jokaisella paikannuksella katsotaan, ollaanko jonkin varoittavan alueen sisällä. Hälytys tulee, kun raja on alle 50 m päässä ja kun raja ylitetään.
const raja = { sisalla: null, lahella: false, teksti: '', ok: false };
function alueTarkista(f) {
  raja.teksti = ''; raja.ok = false;
  const lista = T.as.rajavaroitus ? T.alueet.filter(a => a.varoita && a.p.length >= 3) : [];
  if (!lista.length) { raja.sisalla = null; raja.lahella = false; return; }
  if (f.acc != null && f.acc > 60) return;       // epätarkka sijainti: ei tehdä päätelmiä
  const a = lista.find(x => pisteMonikulmiossa(f.lat, f.lon, x.p));
  if (a) {
    const d = etaisyysReunaan(f.lat, f.lon, a.p);
    if (d < 50 && !raja.lahella) halyta('Alueen ' + a.nimi + ' raja on ' + Math.round(d) + ' metrin päässä.');
    raja.lahella = d < 50 ? true : d > 80 ? false : raja.lahella;
    raja.sisalla = a.id; raja.ok = d >= 100; raja.teksti = d < 100 ? 'Raja ' + Math.round(d / 5) * 5 + ' m' : a.nimi;
  } else {
    if (raja.sisalla) { const ed = T.alueet.find(x => x.id === raja.sisalla); halyta('Ylitit alueen' + (ed ? ' ' + ed.nimi : '') + ' rajan.'); }
    raja.sisalla = null; raja.lahella = false; raja.teksti = 'Alueen ulkopuolella';
  }
}

// ---------- näkymät ----------
function vuosiValinta() {
  const v = new Set([String(new Date().getFullYear())]);
  matkat.forEach(m => v.add(String(new Date(m.alku).getFullYear()))); T.saaliit.forEach(x => v.add(String(new Date(x.aika).getFullYear())));
  return '<select data-c="vuosi">' + [...v].sort().reverse().map(y => '<option' + (y === vuosi ? ' selected' : '') + '>' + y + '</option>').join('') + '<option value="kaikki"' + (vuosi === 'kaikki' ? ' selected' : '') + '>Kaikki</option></select>';
}
const PIN = '<svg viewBox="0 0 24 24"><path d="M12 21s-6.5-6.2-6.5-11a6.5 6.5 0 0 1 13 0c0 4.8-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.3"/></svg>';
// Päänäkymä: koko ruudun maastokartta. Päällä nopeus ja kulkusuunta, kartan napit ja jahdin tila.
function nKartta() {
  const palkki = piirto ? '<div class="kreitti" id="kPiirto"><div class="v"><b>Piirrä alueen raja</b><span id="pTeksti"></span></div><button data-a="piirtoKumoa" aria-label="Poista viimeisin piste" title="Poista viimeisin piste">↶</button><button data-a="piirtoValmis" class="on" aria-label="Valmis" title="Valmis">✓</button><button data-a="piirtoPeru" aria-label="Peruuta" title="Peruuta">✕</button></div>'
    : naytetty ? '<div class="kreitti" id="kJalki"><div class="v"><b>' + e(naytetty.nimi) + '</b><span>Aiemman jahdin jälki · ' + km(naytetty.matka) + '</span></div><button data-a="jalkiPois" aria-label="Poista jälki kartalta" title="Poista jälki kartalta">✕</button></div>' : '';
  return '<div class="kokok' + (palkki ? ' onreitti' : '') + '"><canvas class="kartta taysi" id="lKartta"></canvas>' +
    '<div class="kyla"><div class="kmittari"><div class="knop"><b id="kNopeus">–</b><span>km/h</span></div><div class="ksuu"><b id="kSuunta">–</b><span id="kIlmans"></span></div><div class="krajat" id="kRaja" hidden></div></div><button class="ktuuli" id="kTuuli" data-a="tuuliAika" hidden title="Vaihda ennusteen ajankohtaa"><b></b><span></span></button></div>' +
    '<div class="knapit"><button data-a="keskita" id="lKarttaK" aria-label="Keskitä omaan sijaintiin" title="Keskitä omaan sijaintiin">' + KESKITA + '</button>' +
    '<button data-a="zoom" data-id="1" aria-label="Lähennä">+</button><button data-a="zoom" data-id="-1" aria-label="Loitonna">−</button>' +
    '<button data-a="merkki" aria-label="Lisää merkintä" title="Lisää merkintä">' + PIN + '</button>' +
    '<button data-a="kartat" aria-label="Karttapohja ja tasot" title="Karttapohja ja tasot"><svg viewBox="0 0 24 24"><path d="M12 3l9 5-9 5-9-5zM3 12l9 5 9-5M3 16l9 5 9-5"/></svg></button></div>' +
    '<button class="ktila" id="kTila" data-a="jahtiSivu"></button>' + palkki + '<div class="ktekija">' + kartta().tekija + '</div></div>';
}
function paivitaLive() {
  const f = gps.viime, m = tal.m, jahdissa = tal.tila === 'matka', paalla = watchId != null, sog = sogNyt();
  if ($('#lKartta')) {
    liveKartta();
    const s = f && paalla && f.cog != null && !isNaN(f.cog) && sog > 0.4 ? f.cog : null;
    $('#kNopeus').textContent = f && paalla ? n(nopeus(sog)) : '–';
    $('#kSuunta').textContent = s != null ? Math.round(s) + '°' : '–';
    $('#kIlmans').textContent = s != null ? ilmansuunta(s) : 'suunta';
    const r = $('#kRaja'); r.hidden = !(paalla && raja.teksti); r.textContent = raja.teksti; r.classList.toggle('ok', raja.ok);
    const t = $('#kTila'); t.className = 'ktila' + (jahdissa ? ' rec' : paalla ? ' odota' : '');
    t.textContent = jahdissa ? 'Jahti käynnissä · ' + km(m.matka) + ' · ' + kesto(((f ? f.t : Date.now()) - m.alku) / 1000) : paalla ? 'GPS päällä · aloita jahti' : (gps.virhe ? 'Sijaintia ei saada' : 'GPS ei ole päällä');
    const pt = $('#pTeksti'); if (pt && piirto) pt.textContent = 'Napauta rajan kulmapisteet kartalle · ' + piirto.p.length + (piirto.p.length === 1 ? ' piste' : ' pistettä') + (piirto.p.length >= 3 ? ' · ' + n(alueMitat(piirto.p).ha) + ' ha' : '');
  }
  if (!$('#lTila')) return;
  $('#lPallo').className = 'pallo' + (jahdissa ? ' rec' : paalla ? ' odota' : '');
  $('#lTila').textContent = jahdissa ? 'Jahti käynnissä' : paalla ? 'GPS päällä' : 'GPS ei ole päällä';
  $('#lSelite').textContent = jahdissa ? 'Alkoi klo ' + klo(m.alku) + '. Jälki tallentuu, kunnes lopetat jahdin. Pidä sovellus auki ja näyttö päällä.' : 'Aloita jahti, niin kuljettu reitti, matka ja aika tallentuvat lokiin.';
  $('#lNopeus').textContent = f && paalla ? n(nopeus(sog)) : '–';
  $('#lMatka').textContent = jahdissa ? n(m.matka / 1000, 2) : '–';
  $('#lAika').textContent = jahdissa ? kesto(((f ? f.t : Date.now()) - m.alku) / 1000) : '–';
  $('#lLiike').textContent = jahdissa ? kesto(m.liike) : '–';
  const tunnus = jahdissa ? 'm' : paalla ? 'p' : 'e';
  if ($('#lNapit').dataset.t !== tunnus) {
    $('#lNapit').dataset.t = tunnus;
    $('#lNapit').innerHTML = jahdissa ? '<button class="nappi paa leva" data-a="lopeta">Lopeta jahti</button>'
      : '<button class="nappi paa" data-a="aloita">Aloita jahti</button>' + (paalla ? '<button class="nappi" data-a="seurantaPois">Sammuta GPS</button>' : '<button class="nappi" data-a="seuranta">Käynnistä GPS</button>');
  }
  $('#lGps').textContent = gps.virhe || (!paalla ? 'Jahdin tallennus käyttää puhelimen GPS:ää ja pitää näytön päällä.' : f ? 'GPS ±' + Math.round(f.acc || 0) + ' m · ' + koord(f.lat, f.lon) : 'Haetaan sijaintia…');
}
function aurinkoKortti() {
  const p = paikkaNyt(); if (!p) return '<div class="kortti"><h2>Aurinko tänään</h2><div class="pieni">Auringon nousu- ja laskuajat näkyvät, kun sijainti on tiedossa. Käynnistä GPS.</div></div>';
  const a = aurinko(p[0], p[1], Date.now()), k = t => t == null ? '–' : klo(t);
  return '<div class="kortti"><h2>Aurinko tänään</h2><div class="aurinko"><div><b>' + k(a.hamaraAlku) + '</b><span>hämärä alkaa</span></div><div><b>' + k(a.nousu) + '</b><span>nousee</span></div><div><b>' + k(a.lasku) + '</b><span>laskee</span></div><div><b>' + k(a.hamaraLoppu) + '</b><span>hämärä päättyy</span></div></div>' +
    '<div class="pieni" style="margin-top:8px">' + (a.nousu == null ? 'Aurinko ei tänään nouse tai laske tällä paikalla. ' : '') + 'Laskettu sijainnille ' + koord(p[0], p[1]) + ', tarkkuus pari minuuttia. Hämärä = aurinko alle 6° horisontin alla. Sallitut metsästysajat ja ampumisen edellytykset tarkistat itse voimassa olevista säädöksistä.</div></div>';
}
function nJahti() {
  return '<div class="kortti"><div class="tila"><span class="pallo" id="lPallo"></span><span id="lTila"></span></div><div class="pieni" id="lSelite"></div>' +
    '<div class="luvut live"><div class="luku nop"><b id="lMatka">–</b><span>km</span></div><div class="luku"><b id="lAika">–</b><span>kesto</span></div><div class="luku"><b id="lLiike">–</b><span>liikkeellä</span></div><div class="luku"><b id="lNopeus">–</b><span>km/h</span></div></div>' +
    '<div class="napit" id="lNapit"></div><div class="pieni" id="lGps" style="margin-top:8px"></div></div>' +
    '<div class="kortti"><h2>Kirjaa</h2><div class="napit isot"><button class="nappi paa" data-a="saalis" data-id="uusi-saalis">Saalis</button><button class="nappi" data-a="saalis" data-id="uusi-havainto">Havainto</button><button class="nappi" data-a="merkki">Merkintä kartalle</button></div>' +
    '<div class="pieni" style="margin-top:8px">Kirjaukseen tallentuu nykyinen sijainti ja kellonaika.</div></div>' + aurinkoKortti();
}
function nLoki() {
  const lista = vuodelta(matkat, m => m.alku).sort((a, b) => b.alku - a.alku);
  const matka = lista.reduce((a, m) => a + m.matka, 0), aika = lista.reduce((a, m) => a + (m.loppu - m.alku) / 1000, 0);
  return '<div class="otsrivi"><h2>Jahdit</h2>' + vuosiValinta() + '</div>' +
    '<div class="kortti"><div class="luvut"><div class="luku"><b>' + lista.length + '</b><span>jahtia</span></div><div class="luku"><b>' + n(matka / 1000) + '</b><span>km</span></div><div class="luku"><b>' + n(aika / 3600) + '</b><span>tuntia</span></div></div></div>' +
    '<div class="kortti">' + (lista.length ? lista.map(m => { const s = T.saaliit.filter(x => x.jahti === m.id && x.tyyppi === 'saalis').reduce((a, x) => a + (x.maara || 1), 0);
      return '<div class="rivi" data-a="avaa" data-id="' + m.id + '"><div class="v"><b>' + e(jahtiNimi(m)) + '</b><span class="pieni">' + pvm(m.alku) + ' klo ' + klo(m.alku) + (s ? ' · saalis ' + s : '') + (m.saa ? ' · ' + e(saaTeksti(m.saa)) : '') + '</span></div><div class="o"><b>' + km(m.matka) + '</b><span class="pieni">' + kesto((m.loppu - m.alku) / 1000) + '</span></div></div>'; }).join('')
      : '<div class="tyhja">Ei vielä jahteja. Aloita jahti Jahti-välilehdeltä.</div>') + '</div>';
}
function nYksi() {
  const m = matkat.find(x => x.id === valittu); if (!m) { nakyma = 'loki'; return nLoki(); }
  const s = m.saa, jonossa = T.saajono.includes(m.id), omat = T.saaliit.filter(x => x.jahti === m.id);
  return '<div class="otsrivi"><button class="nappi pien" data-a="takaisin">‹ Jahdit</button><span class="pieni">' + pvm(m.alku) + '</span></div>' +
    '<div class="kortti"><h2>' + e(jahtiNimi(m)) + '</h2>' +
    '<div class="luvut"><div class="luku"><b>' + n(m.matka / 1000, 2) + '</b><span>km</span></div><div class="luku"><b>' + kesto((m.loppu - m.alku) / 1000) + '</b><span>klo ' + klo(m.alku) + '–' + klo(m.loppu) + '</span></div><div class="luku"><b>' + kesto(m.liike) + '</b><span>liikkeellä</span></div><div class="luku"><b>' + (m.liike ? n(nopeus(m.matka / m.liike)) : '–') + '</b><span>km/h liikkeellä</span></div></div>' +
    (m.katkot ? '<p class="pieni">GPS-seurannassa oli ' + m.katkot + ' katkoa, joten matka voi olla todellista lyhyempi.</p>' : '') +
    (m.huom ? '<p>' + e(m.huom).replace(/\n/g, '<br>') + '</p>' : '') + '</div>' +
    (m.a ? '<div class="kortti"><div class="karttak"><canvas class="kartta" id="kartta"></canvas><div class="knapit"><button data-a="keskita" aria-label="Näytä koko jälki" title="Näytä koko jälki">' + KESKITA + '</button><button data-a="zoom" data-id="1" aria-label="Lähennä">+</button><button data-a="zoom" data-id="-1" aria-label="Loitonna">−</button></div></div><div class="pieni" style="margin-top:6px">' + kartta().tekija + '</div>' +
      '<div class="napit" style="margin-top:8px"><button class="nappi" data-a="jalkiKartalle">Näytä jälki pääkartalla</button></div></div>' +
      '<div class="kortti"><h2>Nopeus jahdin aikana (km/h)</h2><canvas class="kayra" id="kayra"></canvas></div>' : '') +
    '<div class="kortti"><h2>Saaliit ja havainnot (' + omat.length + ')</h2>' + (omat.length ? omat.map(saalisRivi).join('') : '<div class="pieni">Tämän jahdin aikana ei kirjattu saaliita tai havaintoja.</div>') + '</div>' +
    '<div class="kortti"><h2>Sää jahdin aikana</h2>' + (s ? '<div class="luvut"><div class="luku"><b>' + n(s.tuuli) + '</b><span>tuuli m/s ' + ilmansuunta(s.suunta) + '</span></div><div class="luku"><b>' + n(s.puuska) + '</b><span>puuskat m/s</span></div><div class="luku"><b>' + n(s.lampo) + '</b><span>°C</span></div><div class="luku"><b>' + n(s.sade) + '</b><span>sade mm</span></div></div><div class="pieni" style="margin-top:8px">Säämallin arvio jahdin keskikohdasta (Open-Meteo), ei mittaus.</div>'
      : '<div class="pieni">' + (jonossa ? 'Sää haetaan, kun verkkoyhteys on käytössä.' : 'Säätä ei ole haettu.') + '</div>') +
    '<div class="napit"><button class="nappi pien" data-a="saaUudelleen">Hae sää uudelleen</button></div></div>' +
    '<div class="napit"><button class="nappi paa" data-a="muokkaaJahti">Muokkaa</button>' + (m.a ? '<button class="nappi" data-a="gpx">Vie GPX</button>' : '') + '<button class="nappi vaara" data-a="poistaJahti">Poista jahti</button></div>';
}
const saalisRivi = x => '<div class="rivi" data-a="saalis" data-id="' + x.id + '"><span class="lajimerkki" style="background:' + (x.tyyppi === 'saalis' ? '#c0392b' : '#1565c0') + '">' + (x.tyyppi === 'saalis' ? 'S' : 'H') + '</span><div class="v"><b>' + e(x.laji) + (x.maara > 1 ? ' × ' + x.maara : '') + '</b><span class="pieni">' + pvm(x.aika) + ' klo ' + klo(x.aika) +
  [x.sukupuoli, x.ika, x.paino ? n(x.paino) + ' kg' : '', x.huom].filter(v => v && v !== '–').map(v => ' · ' + e(v)).join('') + '</span></div><div class="o"><span class="pieni">' + (x.tyyppi === 'saalis' ? 'saalis' : 'havainto') + (x.lat != null ? '<br>paikka tallessa' : '') + '</span></div></div>';
function nSaaliit() {
  const lista = vuodelta(T.saaliit, x => x.aika).sort((a, b) => b.aika - a.aika), til = lajiTilasto(lista), suurin = Math.max(1, ...til.map(t => t.saalis + t.havainto));
  const sa = lista.filter(x => x.tyyppi === 'saalis').reduce((a, x) => a + (x.maara || 1), 0), ha = lista.filter(x => x.tyyppi !== 'saalis').reduce((a, x) => a + (x.maara || 1), 0);
  return '<div class="otsrivi"><h2>Saaliit ja havainnot</h2>' + vuosiValinta() + '</div>' +
    '<div class="kortti"><div class="luvut"><div class="luku"><b>' + sa + '</b><span>saalista</span></div><div class="luku"><b>' + ha + '</b><span>havaittua eläintä</span></div><div class="luku"><b>' + til.length + '</b><span>lajia</span></div></div>' +
    '<div class="napit" style="margin-top:12px"><button class="nappi paa" data-a="saalis" data-id="uusi-saalis">Kirjaa saalis</button><button class="nappi" data-a="saalis" data-id="uusi-havainto">Kirjaa havainto</button></div></div>' +
    (til.length ? '<div class="kortti"><h2>Lajeittain</h2><div class="palkit">' + til.map(t => '<div class="palkki"><b>' + e(t.laji) + '</b><i style="width:' + Math.round((t.saalis + t.havainto) / suurin * 100) + '%"></i><span>' + t.saalis + ' saalista · ' + t.havainto + ' havaittu</span></div>').join('') + '</div></div>' : '') +
    '<div class="kortti">' + (lista.length ? lista.map(saalisRivi).join('') : '<div class="tyhja">Ei kirjauksia tältä vuodelta.</div>') + '</div>' +
    (lista.length ? '<div class="napit"><button class="nappi" data-a="csv">Vie taulukkoon (CSV)</button></div>' : '');
}
const kopioVanha = () => (matkat.length || T.saaliit.length || T.merkit.length || T.alueet.length) && (!T.kopio || Date.now() - T.kopio > 30 * 864e5);
function nLisaa() {
  const vanha = kopioVanha(), K = kartta();
  return '<div class="kortti"><h2>Sijainti (GPS)</h2><div class="pieni" id="gpsTila"></div><div class="napit"><button class="nappi paa" data-a="gpsLupa">Pyydä sijaintilupa ja käynnistä GPS</button></div>' +
    '<div class="pieni">Jos puhelin ei kysy lupaa tai lupa on estetty, salli sijainti puhelimen asetuksista ja paina nappia uudelleen. <b>iPhone ja iPad:</b> Asetukset → Tietosuoja ja suojaus → Sijaintipalvelut päälle → Safari-sivustot → "Kysy" tai "Appia käytettäessä" ja Tarkka sijainti päälle. <b>Android:</b> Asetukset → Sijainti päälle; Chromessa osoiterivin lukko → Käyttöoikeudet → Sijainti → Salli. Valikoiden nimet vaihtelevat hieman laitteen ja version mukaan.</div></div>' +
    '<div class="kortti"><h2>Karttapohja</h2><label class="kytkin"><span>Kartta</span><select data-c="kartta">' + Object.values(KARTAT).map(k => '<option value="' + k.id + '"' + (k === K ? ' selected' : '') + (k.avain && !T.as.mmlAvain ? ' disabled' : '') + '>' + k.nimi + (k.avain && !T.as.mmlAvain ? ' – vaatii avaimen' : '') + '</option>').join('') + '</select></label>' +
    '<div class="rivi" data-a="mmlAvain"><div class="v"><b>Maanmittauslaitoksen API-avain</b><span class="pieni">' + (T.as.mmlAvain ? 'Avain on tallennettu tälle laitteelle (' + T.as.mmlAvain.length + ' merkkiä).' : 'Ei asetettu. Avaimella saat käyttöön Maanmittauslaitoksen maastokartan ja ilmakuvan sekä karttojen latauksen talteen.') + '</span></div><span class="pieni">' + (T.as.mmlAvain ? 'Vaihda' : 'Aseta') + '</span></div>' +
    '<div class="pieni">Ilman avainta käytössä on OpenTopoMap-maastokartta ja OpenStreetMap. Maanmittauslaitoksen avain on maksuton: se luodaan Maanmittauslaitoksen OmaTili-palvelussa (kohta API-avain), ja liitetään tähän. Avain tallentuu vain tälle laitteelle ja varmuuskopioon.</div></div>' +
    '<div class="kortti"><h2>Metsästysalueet</h2>' + (T.alueet.length ? T.alueet.map(a => { const mi = alueMitat(a.p); return '<div class="rivi" data-a="alue" data-id="' + a.id + '"><div class="v"><b>' + e(a.nimi) + '</b><span class="pieni">' + n(mi.ha) + ' ha · rajaa ' + km(mi.piiri) + (a.varoita ? ' · rajavaroitus päällä' : '') + '</span></div><span class="pieni">Muokkaa</span></div>'; }).join('') : '<div class="pieni">Ei alueita. Piirrä seuran tai oman metsästysalueen raja kartalle, niin sovellus näyttää sen ja varoittaa rajan lähestyessä.</div>') +
    '<label class="kytkin"><span>Varoita alueen rajasta<br><span class="pieni">Värinä ja äänimerkki, kun raja on alle 50 m päässä ja kun ylität sen.</span></span><input type="checkbox" data-c="rajavaroitus"' + (T.as.rajavaroitus ? ' checked' : '') + '></label>' +
    '<div class="napit"><button class="nappi paa" data-a="alueUusi">Piirrä uusi alue kartalle</button></div>' +
    '<div class="pieni">Raja on itse piirtämäsi, ja GPS:n tarkkuus on metsässä usein 5–20 m. Todellinen raja on maastossa ja sopimuksissa – jätä rajaan reilu väli.</div></div>' +
    '<div class="kortti"><h2>Karttamerkinnät (' + T.merkit.length + ')</h2>' + (T.merkit.length ? '<div class="plista">' + T.merkit.map(m => '<div class="rivi" data-a="merkkiMuokkaa" data-id="' + m.id + '"><span class="lajimerkki" style="background:' + MERKIT[m.laji][1] + '">' + MERKIT[m.laji][2] + '</span><div class="v"><b>' + e(m.nimi || MERKIT[m.laji][0]) + '</b><span class="pieni">' + e(MERKIT[m.laji][0]) + ' · ' + koord(m.lat, m.lon) + '</span></div></div>').join('') + '</div>'
      : '<div class="pieni">Ei merkintöjä. Lisää passipaikat, tornit, ruokintapaikat ja muut kohteet kartan merkintänapista.</div>') + '</div>' +
    '<div class="kortti"><h2>Kartat ilman verkkoa</h2><div class="pieni">Katsomasi kartta-alueet tallentuvat laitteelle itsestään ja näkyvät sen jälkeen ilman verkkoa. Kokonaisen alueen voi ladata talteen etukäteen Maanmittauslaitoksen kartoista (kartan tasonappi → Lataa näkyvä alue). <span id="karttaTila"></span></div><div class="napit"><button class="nappi vaara" data-a="tyhjennaKartat">Poista tallennetut kartat</button></div></div>' +
    '<div class="kortti"><h2>Varmuuskopio</h2><div class="pieni">Tiedot ovat vain tämän laitteen selaimessa. Jos selaimen tiedot tyhjennetään tai puhelin vaihtuu, ne häviävät – vie kopio talteen säännöllisesti.' + (T.kopio ? ' Viimeisin kopio ' + pvm(T.kopio) + '.' : ' Kopiota ei ole vielä otettu.') + (vanha ? ' <b>Ota uusi kopio.</b>' : '') + '</div>' +
    '<div class="napit"><button class="nappi paa" data-a="vie">Vie varmuuskopio</button><button class="nappi" data-a="tuo">Palauta kopiosta</button></div><input type="file" id="tuoTiedosto" accept=".json,application/json" hidden></div>' +
    (T.saajono.length ? '<div class="kortti"><h2>Sää</h2><div class="pieni">' + T.saajono.length + ' jahdin sää odottaa verkkoyhteyttä.</div><div class="napit"><button class="nappi" data-a="saaNyt">Hae nyt</button></div></div>' : '') +
    '<div class="kortti"><h2>Hyvä tietää</h2><div class="pieni">Jahdin tallennus toimii vain, kun sovellus on auki ja näyttö päällä; sovellus pitää näytön päällä itse. Karttapohja haetaan valitusta karttapalvelusta ja sää Open-Meteosta noin kilometrin tarkkuuteen pyöristetyllä sijainnilla, jolloin palvelu näkee, mitä aluetta katsot. Muuta tietoa laitteelta ei lähde. Sovellus on muistiinpanojen ja suunnistuksen apu: se ei korvaa karttaa ja kompassia, eikä se tiedä metsästysaikoja, lupia tai alueiden todellisia rajoja.</div></div>';
}
function merkit() {
  $('#lisaaMerkki').textContent = kopioVanha() ? '!' : '';
  $('#verkko').textContent = navigator.onLine ? '' : 'ei verkkoa';
}
function piirra() {
  const f = { kartta: nKartta, jahti: nJahti, loki: nLoki, yksi: nYksi, saaliit: nSaaliit, lisaa: nLisaa }[nakyma] || nKartta;
  $('#sisalto').classList.toggle('taysi', nakyma === 'kartta');
  document.documentElement.style.setProperty('--ylak', $('#yla').offsetHeight + 'px');
  $('#sisalto').innerHTML = f();
  document.querySelectorAll('#valikko button').forEach(b => b.classList.toggle('on', b.dataset.n === (nakyma === 'yksi' ? 'loki' : nakyma)));
  merkit();
  lk = null; paivitaLive();
  if (nakyma === 'yksi' && $('#kartta')) DB.get('jaljet', valittu).then(p => { if (!p || !p.length || !$('#kartta')) return; jalki = p; const uusi = !dv; if (uusi) dv = { lat: 0, lon: 0, z: 10, seuraa: false }; kYksi = new Kartta($('#kartta'), dv); kYksi.pts = p; if (uusi) kYksi.sovita(p); kYksi.piirra(); if ($('#kayra') && p.length > 1) piirraKayra($('#kayra'), p); });
  if (nakyma === 'lisaa') { paivitaKarttaTila(); paivitaGpsTila(); }
}

// ---------- karttapohjat ----------
// Maanmittauslaitoksen kartat vaativat käyttäjän oman API-avaimen. Ilman avainta käytössä ovat OpenTopoMap ja OpenStreetMap.
// talteen = katsotut palat tallennetaan laitteelle, lataus = kokonaisen alueen saa ladata talteen etukäteen (vain MML: muiden palvelujen käyttöehdot eivät salli massalatausta).
const MML = (taso, paate) => (z, x, y) => 'https://avoin-karttakuva.maanmittauslaitos.fi/avoin/wmts/1.0.0/' + taso + '/default/WGS84_Pseudo-Mercator/' + z + '/' + y + '/' + x + '.' + paate + '?api-key=' + encodeURIComponent(T.as.mmlAvain);
const KARTAT = {
  topo: { id: 'topo', nimi: 'Maastokartta (OpenTopoMap)', maxZ: 17, talteen: true, tekija: 'Kartta © OpenStreetMapin tekijät, SRTM · tyyli © OpenTopoMap (CC BY-SA)', url: (z, x, y) => 'https://tile.opentopomap.org/' + z + '/' + x + '/' + y + '.png' },
  mml: { id: 'mml', nimi: 'Maastokartta (Maanmittauslaitos)', maxZ: 16, talteen: true, lataus: true, avain: true, tekija: 'Maastokartta © Maanmittauslaitos, CC BY 4.0', url: MML('maastokartta', 'png') },
  orto: { id: 'orto', nimi: 'Ilmakuva (Maanmittauslaitos)', maxZ: 16, talteen: true, lataus: true, avain: true, tekija: 'Ilmakuva © Maanmittauslaitos, CC BY 4.0', url: MML('ortokuva', 'jpg') },
  osm: { id: 'osm', nimi: 'Tiekartta (OpenStreetMap)', maxZ: 18, talteen: false, tekija: 'Kartta © OpenStreetMapin tekijät. Näkyy vain verkossa.', url: (z, x, y) => 'https://tile.openstreetmap.org/' + z + '/' + x + '/' + y + '.png' }
};
const kartta = () => { const K = KARTAT[T.as.kartta] || KARTAT.topo; return K.avain && !T.as.mmlAvain ? KARTAT.topo : K; };
async function lataaLaatat(K, lista, edistys, tila) {
  let i = 0, ok = 0, ennestaan = 0, puuttuu = 0;
  const tyo = async () => {
    while (i < lista.length && !tila.peru) {
      const [z, x, y] = lista[i++], avain = K.id + '/' + z + '/' + x + '/' + y;
      try {
        if (await DB.onko('laatat', avain)) ennestaan++;
        else { const b = await haeKuva(K.url(z, x, y), 4, true); if (b) { await DB.put('laatat', b, avain); ok++; } else puuttuu++; }
      } catch (x) { puuttuu++; if (x && x.name === 'QuotaExceededError') { tila.taynna = true; tila.peru = true; } }
      edistys(ok + ennestaan + puuttuu, lista.length);
    }
  };
  await Promise.all([tyo(), tyo(), tyo()]);
  for (const [k, m] of muisti) if (m.ei || m.eiDb) muisti.delete(k);
  return { ok, ennestaan, puuttuu };
}
// Kartta-alueen lataus talteen: päänäkymässä näkyvä alue valitulla tarkkuudella.
const LAATTARAJA = 3000, LAATTAKOKO = 0.04;      // Mt / pala, karkea arvio
function lataaAlueIkkuna() {
  const K = kartta();
  if (!K.lataus) { ilmoita('Alueen voi ladata talteen vain Maanmittauslaitoksen kartoista (vaatii oman avaimen, ks. Lisää). Katsomasi alueet tallentuvat silti itsestään.'); return; }
  if (!kLive) return;
  if (!navigator.onLine) { ilmoita('Lataus vaatii verkkoyhteyden.'); return; }
  const b = nakymaRajat(kLive), d = $('#dlg'), tila = { peru: false };
  const tasot = [[13, 'Yleiskuva', 'tiet, vesistöt ja pellot'], [15, 'Tarkka', 'polut, ojat ja korkeuskäyrät'], [16, 'Tarkin', 'kaikki yksityiskohdat']].map(t => t.concat(laattaLista(b, 10, t[0]).length));
  d.innerHTML = '<form method="dialog"><h3>Lataa kartta talteen</h3><div class="pieni">Talteen ladataan kartalla nyt näkyvä alue (' + e(K.nimi) + '), ja se näkyy sen jälkeen ilman verkkoa. Loitonna tai siirrä karttaa ensin, jos haluat eri alueen. Koot ovat arvioita.</div>' +
    tasot.map(t => '<label class="cb"><input type="radio" name="taso" value="' + t[0] + '"' + (t[3] > LAATTARAJA ? ' disabled' : '') + '><span><b>' + t[1] + '</b> – ' + t[2] + '<br><span class="pieni">' + (t[3] > LAATTARAJA ? 'liian suuri alue (' + t[3] + ' palaa) – lähennä karttaa' : t[3] + ' palaa, noin ' + Math.max(1, Math.round(t[3] * LAATTAKOKO)) + ' Mt') + '</span></span></label>').join('') +
    '<progress id="lEd" value="0" max="1" hidden></progress><div class="pieni" id="lTeksti"></div>' +
    '<div class="napit"><button type="button" class="nappi" id="lPeru">Sulje</button><button type="button" class="nappi paa" id="lOk">Lataa</button></div></form>';
  const eka = [...d.querySelectorAll('input[name=taso]')].filter(x => !x.disabled); if (eka.length) eka[Math.min(1, eka.length - 1)].checked = true; else d.querySelector('#lOk').disabled = true;
  d.querySelector('#lPeru').onclick = () => { tila.peru = true; d.close(); };
  d.querySelector('#lOk').onclick = async () => {
    const valinta = d.querySelector('input[name=taso]:checked'); if (!valinta) return;
    const lista = laattaLista(b, 10, +valinta.value), ed = d.querySelector('#lEd'), tx = d.querySelector('#lTeksti');
    d.querySelector('#lOk').disabled = true; d.querySelectorAll('input[name=taso]').forEach(x => x.disabled = true); d.querySelector('#lPeru').textContent = 'Keskeytä'; ed.hidden = false;
    try { if (navigator.storage && navigator.storage.persist) await navigator.storage.persist(); } catch (x) { }
    const r = await lataaLaatat(K, lista, (k, kaikki) => { ed.value = k / kaikki; tx.textContent = k + ' / ' + kaikki + ' palaa'; }, tila);
    if (!d.contains(tx)) { karttaUudelleen(); return; }
    tx.textContent = (tila.taynna ? 'Laitteen tallennustila loppui kesken. ' : tila.peru ? 'Keskeytetty. ' : 'Valmis. ') + 'Ladattu ' + r.ok + ', ennestään tallessa ' + r.ennestaan + (r.puuttuu ? ', ei saatu ' + r.puuttuu + ' (tarkista avain ja yhteys)' : '') + '.';
    d.querySelector('#lPeru').textContent = 'Sulje'; karttaUudelleen();
  };
  d.showModal();
}
async function paivitaKarttaTila() {
  const el = $('#karttaTila'); if (!el) return;
  let teksti = 'Tallessa ' + await DB.maara('laatat') + ' karttapalaa';
  try { const s = await navigator.storage.estimate(); if (s && s.usage) teksti += ' · sovelluksen tiedot yhteensä noin ' + Math.max(1, Math.round(s.usage / 1048576)) + ' Mt'; } catch (x) { }
  if ($('#karttaTila')) $('#karttaTila').textContent = teksti + '.';
}

// ---------- kartan päälle piirrettävät tiedot ----------
function lisatAjasta() { if (!T.as.tuuli) return; clearTimeout(lisa.ajastin); lisa.ajastin = setTimeout(lisatPaivita, 1200); }
function lisatPaivita() {
  if (nakyma !== 'kartta' || !kLive || !kLive.cv.isConnected || !navigator.onLine || !T.as.tuuli) return;
  if ((!lisa.tuuli || Date.now() - lisa.tuuli.aika > 30 * 60000 || siirtynyt(lisa.tuuli.nakyma)) && !(lisa.tuuliVirhe && Date.now() - lisa.tuuliVirhe < 30000)) tuuliHae();
}
// Piirtää alueet, jäljet, merkinnät, saaliit ja tuulen sekä kirjaa napautettavat kohteet (lisa.osumat).
function piirraLisat(c, X, Y, W, H, z) {
  lisa.osumat = [];
  const sisalla = (x, y) => x > -30 && y > -30 && x < W + 30 && y < H + 30;
  const teksti = (s, x, y, koko, vari) => { c.font = '600 ' + koko + 'px system-ui,sans-serif'; c.textAlign = 'center'; c.textBaseline = 'top'; c.lineWidth = 3.5; c.strokeStyle = 'rgba(255,255,255,.92)'; c.strokeText(s, x, y); c.fillStyle = vari; c.fillText(s, x, y); };
  const viiva = (p, kiinni) => { c.beginPath(); p.forEach((q, i) => i ? c.lineTo(X(q[1]), Y(q[0])) : c.moveTo(X(q[1]), Y(q[0]))); if (kiinni) c.closePath(); };
  c.lineJoin = c.lineCap = 'round';
  for (const a of T.alueet) {
    if (a.p.length < 3) continue;
    viiva(a.p, true); c.fillStyle = 'rgba(179,18,143,.07)'; c.fill(); c.lineWidth = 5; c.strokeStyle = 'rgba(255,255,255,.85)'; c.stroke();
    c.setLineDash([9, 6]); c.lineWidth = 2.6; c.strokeStyle = '#b3128f'; c.stroke(); c.setLineDash([]);
    if (z >= 10.5) { const la = a.p.reduce((s, q) => s + q[0], 0) / a.p.length, lo = a.p.reduce((s, q) => s + q[1], 0) / a.p.length; if (sisalla(X(lo), Y(la))) teksti(a.nimi, X(lo), Y(la), 13, '#8a0f6e'); }
  }
  if (naytetty && naytetty.p.length > 1) { viiva(naytetty.p); c.lineWidth = 6; c.strokeStyle = '#fff'; c.stroke(); c.setLineDash([2, 8]); c.lineWidth = 3.5; c.strokeStyle = '#6a1b9a'; c.stroke(); c.setLineDash([]); }
  if (piirto) {
    if (piirto.p.length > 1) { viiva(piirto.p, piirto.p.length > 2); c.fillStyle = 'rgba(232,89,12,.10)'; if (piirto.p.length > 2) c.fill(); c.lineWidth = 5; c.strokeStyle = '#fff'; c.stroke(); c.lineWidth = 2.6; c.strokeStyle = '#e8590c'; c.stroke(); }
    piirto.p.forEach((q, i) => { c.beginPath(); c.arc(X(q[1]), Y(q[0]), i === piirto.p.length - 1 ? 7 : 5, 0, 7); c.fillStyle = '#e8590c'; c.fill(); c.lineWidth = 2; c.strokeStyle = '#fff'; c.stroke(); });
  }
  if (T.as.saaliitKartalla && z >= 9) for (const s of T.saaliit) {
    if (s.lat == null) continue; const x = X(s.lon), y = Y(s.lat); if (!sisalla(x, y)) continue; const sa = s.tyyppi === 'saalis';
    c.beginPath(); c.moveTo(x, y - 9); c.lineTo(x + 9, y); c.lineTo(x, y + 9); c.lineTo(x - 9, y); c.closePath(); c.fillStyle = sa ? '#c0392b' : '#1565c0'; c.fill(); c.lineWidth = 2; c.strokeStyle = '#fff'; c.stroke();
    if (z >= 14) teksti(s.laji + (s.maara > 1 ? ' × ' + s.maara : ''), x, y + 11, 11.5, sa ? '#8f1d12' : '#0d47a1');
    lisa.osumat.push({ x, y, r: 22, laji: 'saalis', d: s });
  }
  if (T.as.merkitKartalla && z >= 8) for (const m of T.merkit) {
    const x = X(m.lon), y = Y(m.lat); if (!sisalla(x, y)) continue; const L = MERKIT[m.laji] || MERKIT.muu;
    c.beginPath(); c.arc(x, y, 11, 0, 7); c.fillStyle = L[1]; c.fill(); c.lineWidth = 2.5; c.strokeStyle = '#fff'; c.stroke();
    c.font = '700 12px system-ui,sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillStyle = '#fff'; c.fillText(L[2], x, y + .5);
    if (z >= 13 && m.nimi) teksti(m.nimi, x, y + 13, 12, '#12222f');
    lisa.osumat.push({ x, y, r: 24, laji: 'merkki', d: m });
  }
  const tuuli = T.as.tuuli && lisa.tuuli, i = TUNNIT[lisa.tunti];
  if (tuuli) for (const p of tuuli.p) {
    const v = p.nop[i], x = X(p.lon), y = Y(p.lat); if (v == null || !sisalla(x, y)) continue;
    const L = 9 + Math.min(v, 20) * 0.8, vari = tuuliVari(v);
    c.save(); c.translate(x, y); c.rotate(((p.suu[i] || 0) + 180) * RAD);      // nuoli osoittaa suuntaan, johon tuuli puhaltaa (minne haju kulkee)
    for (const [w, vv] of [[6.5, 'rgba(255,255,255,.92)'], [3, vari]]) { c.lineWidth = w; c.strokeStyle = vv; c.beginPath(); c.moveTo(0, L); c.lineTo(0, -L); c.moveTo(-6, -L + 8); c.lineTo(0, -L); c.lineTo(6, -L + 8); c.stroke(); }
    c.restore(); teksti(n(v, 0), x, y + L + 3, 13, vari);
  }
  const chip = $('#kTuuli');
  if (chip) {
    chip.hidden = !T.as.tuuli;
    if (T.as.tuuli) {
      let ala = navigator.onLine ? 'Haetaan säätä…' : 'Ei verkkoa';
      if (tuuli) { let pa = null, pd = Infinity; for (const p of tuuli.p) { const d = etaisyys(p.lat, p.lon, lv.lat, lv.lon); if (d < pd && p.nop[i] != null) { pd = d; pa = p; } }
        if (pa) ala = n(pa.nop[i], 0) + ' m/s ' + ilmansuunta(pa.suu[i]) + ' · puuskat ' + n(pa.pus[i], 0) + ' · ' + n(pa.lam[i], 0) + ' °C' + (pa.sade[i] > 0 ? ' · sade ' + n(pa.sade[i]) + ' mm' : ''); }
      chip.querySelector('b').textContent = 'Tuuli ' + (i ? '+' + i + ' h' + (tuuli ? ' · klo ' + klo(tuuli.ajat[i]) : '') : 'nyt');
      chip.querySelector('span').textContent = ala;
    }
  }
}
// Kartan napautus: avaa lähimmän merkinnän tai kirjauksen.
function karttaNapautus(x, y) {
  let paras = null, pd = Infinity; for (const o of lisa.osumat) { const d = Math.hypot(o.x - x, o.y - y); if (d <= o.r && d < pd) { pd = d; paras = o; } }
  if (paras) paras.laji === 'merkki' ? A.merkkiMuokkaa(paras.d.id) : A.saalis(paras.d.id);
}

// ---------- merkinnät, alueet ja kirjaukset ----------
// Uusi karttamerkintä: laji ja nimi, paikaksi oma sijainti tai kartalta napautettu kohta.
function merkkiIkkuna() {
  const d = $('#dlg'), s = paikkaNyt();
  d.innerHTML = '<form method="dialog"><h3>Uusi merkintä kartalle</h3><label>Laji<select id="mLaji">' + Object.keys(MERKIT).map(k => '<option value="' + k + '">' + MERKIT[k][0] + '</option>').join('') + '</select></label>' +
    '<label>Nimi (ei pakollinen)<input id="mNimi" autocomplete="off" placeholder="esim. Kuusikon passi"></label><label>Muistiinpano<textarea id="mHuom" rows="2"></textarea></label>' +
    '<div class="pieni">' + (s ? 'Oma sijainti: ' + koord(s[0], s[1]) + (gps.viime && watchId != null ? ' (±' + Math.round(gps.viime.acc || 0) + ' m)' : ' (viimeisin tunnettu)') : 'Omaa sijaintia ei ole – valitse paikka kartalta tai käynnistä GPS.') + '</div>' +
    '<button type="button" class="nappi paa" id="mTassa"' + (s ? '' : ' disabled') + '>Tallenna omaan sijaintiin</button><button type="button" class="nappi" id="mKartta">Valitse paikka kartalta</button>' +
    '<div class="napit"><button type="button" class="nappi" id="mPeru">Peruuta</button></div></form>';
  const uusi = async (la, lo) => { const m = { id: uusiId(), laji: d.querySelector('#mLaji').value, nimi: d.querySelector('#mNimi').value.trim(), huom: d.querySelector('#mHuom').value.trim(), lat: +la.toFixed(6), lon: +lo.toFixed(6), luotu: Date.now() }; T.merkit.push(m); await talletaT(); ilmoita('Merkintä tallennettu: ' + (m.nimi || MERKIT[m.laji][0])); return m; };
  d.querySelector('#mPeru').onclick = () => d.close();
  d.querySelector('#mTassa').onclick = async () => { d.close(); await uusi(s[0], s[1]); piirra(); };
  d.querySelector('#mKartta').onclick = () => {
    d.close(); nakyma = 'kartta'; piirra(); ilmoita('Napauta merkinnän paikkaa kartalla.');
    napautusCb = async (la, lo) => { napautusCb = null; await uusi(la, lo); piirra(); };
  };
  d.showModal();
}
// Saaliin tai havainnon kirjaus. id = olemassa olevan tunniste tai 'uusi-saalis' / 'uusi-havainto'.
function saalisIkkuna(id) {
  const x = T.saaliit.find(s => s.id === id), tyyppi = x ? x.tyyppi : id === 'uusi-havainto' ? 'havainto' : 'saalis', s = paikkaNyt(), sa = tyyppi === 'saalis';
  const kentat = [{ k: 'laji', n: 'Laji', t: 'sel', o: LAJIT }, { k: 'maara', n: sa ? 'Määrä (kpl)' : 'Eläinten määrä', t: 'num', req: 1 }, { k: 'sukupuoli', n: 'Sukupuoli', t: 'sel', o: ['–', 'Uros', 'Naaras'] }, { k: 'ika', n: 'Ikä', t: 'sel', o: ['–', 'Aikuinen', 'Nuori tai vasa'] }]
    .concat(sa ? [{ k: 'paino', n: 'Paino (kg)', t: 'num' }] : []).concat([{ k: 'aika', n: 'Aika', t: 'datetime-local', req: 1 }, { k: 'huom', n: 'Muistiinpano', t: 'area' }])
    .concat(x ? (x.lat != null ? [{ k: 'paikka', n: 'Säilytä tallennettu paikka (' + koord(x.lat, x.lon) + ')', t: 'cb' }] : []) : s ? [{ k: 'paikka', n: 'Tallenna paikaksi nykyinen sijainti', t: 'cb' }] : []);
  lomake(x ? (sa ? 'Muokkaa saalista' : 'Muokkaa havaintoa') : sa ? 'Kirjaa saalis' : 'Kirjaa havainto', kentat,
    x ? Object.assign({}, x, { aika: dtl(x.aika), paikka: true }) : { laji: T.viimeLaji || LAJIT[0], maara: 1, sukupuoli: '–', ika: '–', aika: dtl(Date.now()), paikka: true },
    async o => {
      const t = { tyyppi, laji: o.laji, maara: Math.max(1, Math.round(o.maara || 1)), sukupuoli: o.sukupuoli, ika: o.ika, paino: sa ? o.paino : null, aika: new Date(o.aika).getTime() || Date.now(), huom: o.huom };
      if (x) { if (x.lat != null && !o.paikka) { x.lat = x.lon = null; } Object.assign(x, t); }
      else { const uusi = Object.assign({ id: uusiId(), lat: o.paikka && s ? +s[0].toFixed(6) : null, lon: o.paikka && s ? +s[1].toFixed(6) : null, jahti: tal.tila === 'matka' ? 'm' + tal.m.alku : null }, t); T.saaliit.push(uusi); T.viimeLaji = o.laji; ilmoita((sa ? 'Saalis' : 'Havainto') + ' kirjattu: ' + o.laji + (uusi.maara > 1 ? ' × ' + uusi.maara : '')); }
      await talletaT();
    }, x && (async () => { T.saaliit = T.saaliit.filter(q => q !== x); await talletaT(); }));
}
function piirtoAloita() {
  piirto = { p: [] }; naytetty = null; nakyma = 'kartta'; piirra(); ilmoita('Napauta alueen rajan kulmapisteet kartalle järjestyksessä.');
  napautusCb = (la, lo) => { piirto.p.push([+la.toFixed(6), +lo.toFixed(6)]); if (kLive) kLive.piirra(); paivitaLive(); };
}
function piirtoLopeta() { piirto = null; napautusCb = null; piirra(); }

// ---------- toiminnot ----------
const A = {
  seuranta() { seurantaPaalle(); },
  seurantaPois() { seurantaPois(); piirra(); },
  gpsLupa() { gpsLupa(); },
  aloita() {
    if (watchId == null) seurantaPaalle(true);
    const f = gps.viime, tuore = f && Date.now() - f.t < 60000;
    tal.viime = null; tal.aloita(tuore ? f.t : Date.now(), tuore ? f : null); DB.put('kv', tal.vie(), 'kesken'); ilmoita('Jahti alkoi – jälki tallentuu.'); piirra();
  },
  async lopeta() {
    if (tal.tila !== 'matka') return;
    const m = tal.lopeta(tal.viime ? Math.max(tal.viime.t, tal.m.alku) : Date.now()), j = await tallennaJahti(m);
    ilmoita('Jahti tallennettu: ' + km(j.matka) + ', ' + kesto((j.loppu - j.alku) / 1000) + '.'); A.avaa(j.id);
  },
  jahtiSivu() { nakyma = 'jahti'; piirra(); },
  avaa(id) { valittu = id; nakyma = 'yksi'; dv = null; jalki = null; piirra(); window.scrollTo(0, 0); },
  takaisin() { nakyma = 'loki'; piirra(); },
  zoom(d) { const k = nakyma === 'kartta' ? kLive : kYksi; if (k) k.zoomaa(+d); },
  keskita() {
    if (nakyma === 'yksi') { if (kYksi && jalki) { kYksi.sovita(jalki); kYksi.piirra(); } return; }
    if (!gps.viime && !T.sij) { ilmoita('Sijaintia ei ole vielä. Käynnistä GPS.'); return; }
    lv.seuraa = true; karttaUudelleen();
  },
  merkki() { merkkiIkkuna(); },
  merkkiMuokkaa(id) {
    const m = T.merkit.find(x => x.id === id); if (!m) return;
    lomake('Merkintä', [{ k: 'laji', n: 'Laji', t: 'sel', o: Object.keys(MERKIT).map(k => MERKIT[k][0]) }, { k: 'nimi', n: 'Nimi' }, { k: 'huom', n: 'Muistiinpano', t: 'area' }], { laji: MERKIT[m.laji][0], nimi: m.nimi, huom: m.huom },
      async o => { m.laji = merkkiAvain(o.laji); m.nimi = o.nimi; m.huom = o.huom; await talletaT(); }, async () => { T.merkit = T.merkit.filter(x => x !== m); await talletaT(); });
  },
  saalis(id) { saalisIkkuna(id); },
  alueUusi() { piirtoAloita(); },
  piirtoKumoa() { if (piirto && piirto.p.length) { piirto.p.pop(); if (kLive) kLive.piirra(); paivitaLive(); } },
  piirtoPeru() { piirtoLopeta(); },
  piirtoValmis() {
    if (!piirto || piirto.p.length < 3) { ilmoita('Alueeseen tarvitaan vähintään kolme kulmapistettä.'); return; }
    lomake('Uusi metsästysalue', [{ k: 'nimi', n: 'Alueen nimi', req: 1 }, { k: 'varoita', n: 'Varoita, kun lähestyn rajaa tai ylitän sen', t: 'cb' }], { nimi: 'Metsästysalue ' + (T.alueet.length + 1), varoita: true },
      async o => { T.alueet.push({ id: uusiId(), nimi: o.nimi, varoita: o.varoita, p: piirto.p, luotu: Date.now() }); piirto = null; napautusCb = null; await talletaT(); ilmoita('Alue tallennettu: ' + o.nimi); });
  },
  alue(id) {
    const a = T.alueet.find(x => x.id === id); if (!a) return;
    lomake('Metsästysalue', [{ k: 'nimi', n: 'Alueen nimi', req: 1 }, { k: 'varoita', n: 'Varoita, kun lähestyn rajaa tai ylitän sen', t: 'cb' }, { k: 'nayta', n: 'Näytä alue kartalla tallennuksen jälkeen', t: 'cb' }], { nimi: a.nimi, varoita: a.varoita, nayta: false },
      async o => { a.nimi = o.nimi; a.varoita = o.varoita; await talletaT(); if (o.nayta) { nakyma = 'kartta'; lv.seuraa = false; lv.alussa = false; setTimeout(() => { if (kLive) { kLive.sovita(a.p.map(q => [0, q[0], q[1]])); kLive.piirra(); seuraaMerkki(); } }, 0); } },
      async () => { T.alueet = T.alueet.filter(x => x !== a); raja.sisalla = null; await talletaT(); });
  },
  // Vanhan jahdin jälki pääkartalle, esimerkiksi saman reitin kulkemiseen uudelleen.
  async jalkiKartalle() {
    const m = matkat.find(x => x.id === valittu), j = m && await DB.get('jaljet', valittu); if (!j || j.length < 2) { ilmoita('Tällä jahdilla ei ole tallennettua jälkeä.'); return; }
    naytetty = { nimi: jahtiNimi(m) + ' (' + pvm(m.alku) + ')', matka: m.matka, p: yksinkertaista(j.map(q => [q[1], q[2]]), 6) };
    nakyma = 'kartta'; lv.seuraa = false; lv.alussa = false; piirra();
    if (kLive) { kLive.sovita(naytetty.p.map(q => [0, q[0], q[1]])); kLive.piirra(); seuraaMerkki(); }
  },
  jalkiPois() { naytetty = null; piirra(); },
  kartat() {
    const d = $('#dlg'), K = kartta();
    d.innerHTML = '<form method="dialog"><h3>Kartta</h3><label>Karttapohja<select id="kPohja">' + Object.values(KARTAT).map(k => '<option value="' + k.id + '"' + (k === K ? ' selected' : '') + (k.avain && !T.as.mmlAvain ? ' disabled' : '') + '>' + k.nimi + (k.avain && !T.as.mmlAvain ? ' – vaatii avaimen' : '') + '</option>').join('') + '</select></label>' +
      [['merkitKartalla', 'Karttamerkinnät'], ['saaliitKartalla', 'Saaliit ja havainnot'], ['tuuli', 'Tuulen suunta ja nopeus']].map(k => '<label class="cb"><input type="checkbox" data-taso="' + k[0] + '"' + (T.as[k[0]] ? ' checked' : '') + '>' + k[1] + '</label>').join('') +
      '<div class="pieni">Tuulinuoli osoittaa suuntaan, johon tuuli puhaltaa. Tuuli on säämallin ennuste (Open-Meteo) eikä ota huomioon maaston paikallisia pyörteitä.' + (T.as.mmlAvain ? '' : ' Maanmittauslaitoksen kartat saat käyttöön asettamalla oman avaimen Lisää-sivulla.') + '</div>' +
      '<button type="button" class="nappi" id="kAlue">Lataa näkyvä alue talteen</button>' +
      '<div class="napit"><button type="button" class="nappi paa" id="kSulje">Sulje</button></div></form>';
    d.querySelector('#kPohja').onchange = async ev => { T.as.kartta = ev.target.value; await talletaT(); piirra(); };
    d.querySelectorAll('[data-taso]').forEach(el => el.onchange = async () => { T.as[el.dataset.taso] = el.checked; await talletaT(); if (kLive) kLive.piirra(); lisatPaivita(); });
    d.querySelector('#kAlue').onclick = () => { d.close(); lataaAlueIkkuna(); };
    d.querySelector('#kSulje').onclick = () => d.close();
    d.showModal();
  },
  tuuliAika() { lisa.tunti = (lisa.tunti + 1) % TUNNIT.length; if (kLive) kLive.piirra(); },
  mmlAvain() {
    lomake('Maanmittauslaitoksen API-avain', [{ k: 'avain', n: 'API-avain (tyhjä poistaa avaimen)' }], { avain: T.as.mmlAvain },
      async o => { T.as.mmlAvain = o.avain.replace(/\s/g, ''); if (T.as.mmlAvain && T.as.kartta === 'topo') T.as.kartta = 'mml'; for (const k of [...muisti.keys()]) if (/^(mml|orto)\//.test(k)) muisti.delete(k); await talletaT(); ilmoita(T.as.mmlAvain ? 'Avain tallennettu. Jos kartta ei näy, tarkista avain.' : 'Avain poistettu.'); });
  },
  async tyhjennaKartat() { if (!confirm('Poistetaanko kaikki laitteelle tallennetut kartat?')) return; await DB.tyhjenna('laatat'); muisti.clear(); ilmoita('Tallennetut kartat poistettu.'); piirra(); },
  async poistaJahti() {
    const m = matkat.find(x => x.id === valittu); if (!m) return;
    if (!confirm('Poistetaanko jahti ' + pvm(m.alku) + ' (' + km(m.matka) + ') pysyvästi? Myös jälki poistuu. Jahdin aikana kirjatut saaliit ja havainnot säilyvät.')) return;
    await poistaJahdit([m.id]); nakyma = 'loki'; piirra(); ilmoita('Jahti poistettu.');
  },
  muokkaaJahti() {
    const m = matkat.find(x => x.id === valittu);
    lomake('Muokkaa jahtia', [{ k: 'nimi', n: 'Nimi tai paikka' }, { k: 'huom', n: 'Muistiinpanot (porukka, koira, tapahtumat)', t: 'area' }], { nimi: m.nimi, huom: m.huom },
      async o => { m.nimi = o.nimi; m.huom = o.huom; await DB.put('matkat', m); });
  },
  async gpx() { const m = matkat.find(x => x.id === valittu), p = await DB.get('jaljet', valittu); if (p) lataa('jahti-' + paiva(m.alku) + '.gpx', gpx(jahtiNimi(m), p).replace('creator="Kippari Pro"', 'creator="Metsästäjä Pro"'), 'application/gpx+xml'); },
  async saaUudelleen() { const m = matkat.find(x => x.id === valittu); if (!navigator.onLine) { ilmoita('Ei verkkoyhteyttä.'); return; } const ok = await haeSaa(m); ilmoita(ok && m.saa ? 'Sää päivitetty.' : 'Säätä ei saatu tälle jahdille.'); piirra(); },
  saaNyt() { if (!navigator.onLine) ilmoita('Ei verkkoyhteyttä.'); else paivitaSaat(); },
  csv() {
    const r = [['Päivä', 'Kello', 'Tyyppi', 'Laji', 'Määrä', 'Sukupuoli', 'Ikä', 'Paino kg', 'Leveysaste', 'Pituusaste', 'Muistiinpano']];
    for (const x of [...T.saaliit].sort((a, b) => a.aika - b.aika)) r.push([pvm(x.aika), klo(x.aika), x.tyyppi, x.laji, x.maara, x.sukupuoli === '–' ? '' : x.sukupuoli, x.ika === '–' ? '' : x.ika, x.paino != null ? String(x.paino).replace('.', ',') : '', x.lat != null ? String(x.lat).replace('.', ',') : '', x.lon != null ? String(x.lon).replace('.', ',') : '', x.huom]);
    lataa('metsastaja-pro-saaliit.csv', '﻿' + r.map(x => x.map(v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"').join(';')).join('\r\n'), 'text/csv');
  },
  async vie() {
    const jaljet = {}; for (const m of matkat) { const p = await DB.get('jaljet', m.id); if (p) jaljet[m.id] = p; }
    T.kopio = Date.now(); await talletaT();
    lataa('metsastaja-pro-' + paiva(Date.now()) + '.json', JSON.stringify({ metsastaja: 1, tila: T, matkat, jaljet }), 'application/json'); piirra();
  },
  tuo() { $('#tuoTiedosto').click(); }
};
async function palauta(teksti) {
  let o; try { o = JSON.parse(teksti); } catch (x) { o = null; }
  if (!o || o.metsastaja !== 1 || !o.tila || !Array.isArray(o.matkat)) { ilmoita('Tiedosto ei ole Metsästäjä Pron varmuuskopio.'); return false; }
  if (!confirm('Palautus korvaa kaikki nykyiset tiedot (' + matkat.length + ' jahtia, ' + T.saaliit.length + ' kirjausta) kopion tiedoilla (' + o.matkat.length + ' jahtia, ' + (o.tila.saaliit || []).length + ' kirjausta). Jatketaanko?')) return false;
  await DB.tyhjenna('matkat'); await DB.tyhjenna('jaljet');
  for (const m of o.matkat) await DB.put('matkat', m);
  for (const id in o.jaljet || {}) await DB.put('jaljet', o.jaljet[id], id);
  T = Object.assign(uusiTila(), o.tila); T.as = Object.assign(uusiTila().as, o.tila.as, { seuranta: watchId != null });
  matkat = o.matkat; await talletaT(); piirra(); ilmoita('Tiedot palautettu.'); return true;
}

// ---------- käynnistys ----------
async function alku() {
  await DB.avaa();
  const s = await DB.get('kv', 'tila') || {};
  T = Object.assign(uusiTila(), s); T.as = Object.assign(uusiTila().as, s.as);
  matkat = await DB.all('matkat');
  // Jahti aloitetaan ja lopetetaan aina itse: passissa istuminen ei saa päättää tallennusta. Metsässä GPS on epätarkempi kuin vesillä.
  // Matkaa kertyy vasta 15 m siirtymästä, jotta GPS:n heilunta paikallaan istuessa ei kasvata kuljettua matkaa.
  tal = new Tallennin({ auto: false, tarkkuus: 50, valiM: 15 });
  const k = await DB.get('kv', 'kesken');
  if (k && k.tila === 'matka' && k.m) {          // sovellus suljettiin kesken jahdin
    tal.tuo(k);
    const viim = k.viime ? k.viime.t : k.m.alku;
    if (Date.now() - viim > 6 * 3600000) await tallennaJahti(tal.lopeta(viim));      // yli 6 tuntia vanha: tallennetaan valmiina jahtina
  }
  $('#valikko').addEventListener('click', ev => { const b = ev.target.closest('button[data-n]'); if (b) { if (piirto && b.dataset.n !== 'kartta') piirtoLopeta(); nakyma = b.dataset.n; piirra(); window.scrollTo(0, 0); } });
  $('#sisalto').addEventListener('click', ev => { const el = ev.target.closest('[data-a]'); if (el && A[el.dataset.a]) A[el.dataset.a](el.dataset.id); });
  $('#sisalto').addEventListener('change', async ev => {
    const el = ev.target, c = el.dataset.c;
    if (c === 'vuosi') { vuosi = el.value; piirra(); }
    else if (c === 'kartta') { T.as.kartta = el.value; await talletaT(); piirra(); }
    else if (c === 'rajavaroitus') { T.as.rajavaroitus = el.checked; raja.sisalla = null; raja.teksti = ''; await talletaT(); }
    else if (el.id === 'tuoTiedosto' && el.files[0]) palauta(await el.files[0].text());
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') { if (tal.tila === 'matka') DB.put('kv', tal.vie(), 'kesken'); talletaT(); }
    else if (watchId != null) seurantaPaalle(true);      // paikannus ja näytön lukitus käyntiin uudelleen
  });
  window.addEventListener('online', () => { merkit(); paivitaSaat(); for (const [k, m] of muisti) if (m.ei || m.eiDb) muisti.delete(k); karttaUudelleen(); });
  window.addEventListener('offline', merkit);
  window.addEventListener('resize', () => { document.documentElement.style.setProperty('--ylak', $('#yla').offsetHeight + 'px'); karttaUudelleen(); });
  setInterval(() => { if (T && nakyma === 'kartta') lisatPaivita(); if (tal.tila === 'matka') paivitaLive(); }, 60000);
  const testi = /[?&]testi/.test(location.search);
  if ((T.as.seuranta || tal.tila === 'matka') && !testi) seurantaPaalle(true);
  piirra(); paivitaSaat();
  if ('serviceWorker' in navigator && !testi) navigator.serviceWorker.register('sw.js').catch(() => { });
  window.__valmis = true;
}
alku().catch(x => { $('#sisalto').innerHTML = '<div class="kortti">Sovellus ei käynnistynyt: ' + e(x && x.message || x) + '</div>'; window.__virhe = String(x && x.stack || x); });
