// Metsästäjä Pron pohja: karttamoottori, tallennus (IndexedDB), lomake, paikannus ja sää. KOOTTU AUTOMAATTISESTI Kippari Pron koodista
// komennolla  node testi\rakenna-pohja.js  – älä muokkaa käsin, vaan tee muutos Kippari Prohon tai tiedostoon sovellus.js.
'use strict';

const $ = s => document.querySelector(s);
const e = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const n = (x, d = 1) => x == null || isNaN(x) ? '–' : Number(x).toLocaleString('fi-FI', { minimumFractionDigits: d, maximumFractionDigits: d });
const luku = s => { const v = parseFloat(String(s).replace(/\s/g, '').replace(',', '.')); return isNaN(v) ? null : v; };
const pad = x => String(x).padStart(2, '0');
const pvm = t => new Date(t).toLocaleDateString('fi-FI');
const klo = t => pad(new Date(t).getHours()) + '.' + pad(new Date(t).getMinutes());
const paiva = t => { const d = new Date(t); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); };
const dtl = t => paiva(t) + 'T' + pad(new Date(t).getHours()) + ':' + pad(new Date(t).getMinutes());
const kesto = s => { s = Math.max(0, Math.round(s / 60)); return s < 60 ? s + ' min' : Math.floor(s / 60) + ' h ' + pad(s % 60) + ' min'; };
const koord = (lat, lon) => { const f = (v, a, b) => { const x = Math.abs(v), d = Math.floor(x); return d + '°' + n((x - d) * 60, 1) + "'" + (v >= 0 ? a : b); }; return f(lat, 'P', 'E') + ' ' + f(lon, 'I', 'L'); };

// ---------- tallennus ----------
const DB = {
  db: null,
  avaa() { return new Promise((ok, ei) => { const r = indexedDB.open('metsastaja', 2); r.onupgradeneeded = () => { const d = r.result, on = n => d.objectStoreNames.contains(n); if (!on('matkat')) d.createObjectStore('matkat', { keyPath: 'id' }); for (const n of ['jaljet', 'kv', 'laatat']) if (!on(n)) d.createObjectStore(n); }; r.onsuccess = () => { DB.db = r.result; ok(); }; r.onerror = () => ei(r.error); }); },
  tx(s, tapa, f) { return new Promise((ok, ei) => { const t = DB.db.transaction(s, tapa); const r = f(t.objectStore(s)); t.oncomplete = () => ok(r && r.result); t.onerror = () => ei(t.error); t.onabort = () => ei(t.error); }); },
  get: (s, k) => DB.tx(s, 'readonly', o => o.get(k)),
  all: s => DB.tx(s, 'readonly', o => o.getAll()),
  put: (s, v, k) => DB.tx(s, 'readwrite', o => k === undefined ? o.put(v) : o.put(v, k)),
  del: (s, k) => DB.tx(s, 'readwrite', o => o.delete(k)),
  tyhjenna: s => DB.tx(s, 'readwrite', o => o.clear()),
  onko: (s, k) => DB.tx(s, 'readonly', o => o.getKey(k)).then(v => v !== undefined),
  maara: s => DB.tx(s, 'readonly', o => o.count())
};

function ilmoita(t) { const el = $('#ilmoitus'); el.textContent = t; el.classList.add('on'); clearTimeout(ilmoita.a); ilmoita.a = setTimeout(() => el.classList.remove('on'), 4200); }
function lataa(nimi, sisalto, tyyppi) { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([sisalto], { type: tyyppi })); a.download = nimi; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000); }

// ---------- lomake ----------
function lomake(otsikko, kentat, arvot, tallenna, poista) {
  const d = $('#dlg');
  d.innerHTML = '<form method="dialog"><h3>' + e(otsikko) + '</h3>' + kentat.map(k => {
    const v = arvot[k.k], id = 'f_' + k.k;
    if (k.t === 'cb') return '<label class="cb"><input type="checkbox" id="' + id + '"' + (v ? ' checked' : '') + '>' + e(k.n) + '</label>';
    if (k.t === 'sel') return '<label>' + e(k.n) + '<select id="' + id + '">' + k.o.map(o => '<option' + (o === v ? ' selected' : '') + '>' + e(o) + '</option>').join('') + '</select></label>';
    if (k.t === 'area') return '<label>' + e(k.n) + '<textarea id="' + id + '" rows="3">' + e(v) + '</textarea></label>';
    if (k.t === 'num') return '<label>' + e(k.n) + '<input id="' + id + '" inputmode="decimal" autocomplete="off" value="' + (v == null ? '' : e(String(v).replace('.', ','))) + '"' + (k.req ? ' required' : '') + '></label>';
    return '<label>' + e(k.n) + '<input id="' + id + '" type="' + (k.t || 'text') + '" value="' + e(v) + '"' + (k.req ? ' required' : '') + '></label>';
  }).join('') + '<div class="napit">' + (poista ? '<button type="button" class="nappi vaara" id="fPoista">Poista</button>' : '') +
    '<button type="button" class="nappi" id="fPeru">Peruuta</button><button class="nappi paa" id="fOk">Tallenna</button></div></form>';
  d.querySelector('#fPeru').onclick = () => d.close();
  if (poista) d.querySelector('#fPoista').onclick = async () => { if (confirm('Poistetaanko pysyvästi?')) { d.close(); await poista(); piirra(); } };
  d.querySelector('form').onsubmit = async ev => {
    ev.preventDefault(); const o = {};
    for (const k of kentat) {
      const el = d.querySelector('#f_' + k.k);
      o[k.k] = k.t === 'cb' ? el.checked : k.t === 'num' ? luku(el.value) : el.value.trim();
      if (k.t === 'num' && k.req && o[k.k] == null) { el.focus(); return; }
    }
    d.close(); await tallenna(o); piirra();
  };
  d.showModal();
}

// ---------- paikannus ----------
function seurantaPaalle(hiljaa) {
  if (!navigator.geolocation) { gps.virhe = 'Tämä selain ei tue paikannusta.'; piirra(); return; }
  if (watchId != null) navigator.geolocation.clearWatch(watchId);
  watchId = navigator.geolocation.watchPosition(p => {
    let t = p.timestamp; if (!t || Math.abs(t - Date.now()) > 864e5) t = Date.now();
    fix({ t, lat: p.coords.latitude, lon: p.coords.longitude, acc: p.coords.accuracy, sog: p.coords.speed, cog: p.coords.heading });
  }, err => {
    gps.virhe = err.code === 1 ? 'Sijaintilupa puuttuu. Salli sijainti tälle sivulle selaimen asetuksista.' : 'Sijaintia ei saada juuri nyt (' + (err.code === 3 ? 'aikakatkaisu' : 'ei signaalia') + ').';
    if (err.code === 1) { seurantaPois(); }
    paivitaLive();
  }, { enableHighAccuracy: true, maximumAge: 2000, timeout: 30000 });
  if (!T.as.seuranta) { T.as.seuranta = true; talletaT(); }
  gps.virhe = ''; naytto(true);
  if (!hiljaa) piirra();
}
function seurantaPois() {
  if (watchId != null) navigator.geolocation.clearWatch(watchId);
  watchId = null; T.as.seuranta = false; talletaT(); naytto(false);
}
// Sijaintiluvan tila Lisää-sivulle. Selaimen lupatieto (Permissions API) ei ole kaikissa selaimissa, jolloin tila päätellään viimeisestä yrityksestä.
// iPad ja iPhone eivät näytä lupakyselyä eivätkä aina edes vastaa pyyntöön, jos sijaintipalvelut ovat pois tai Safarin sijaintilupa on estetty: se tunnistetaan odotusajasta (gps.eiVastaa).
const onIos = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const IOS_OHJE = 'Tee iPadissa tai iPhonessa näin: 1) Asetukset → Tietosuoja ja suojaus → Sijaintipalvelut: kytke Sijaintipalvelut päälle. 2) Samassa luettelossa Safari-sivustot: valitse "Kysy seuraavalla kerralla tai kun jaan" tai "Appia käytettäessä" ja kytke Tarkka sijainti päälle. 3) Asetukset → Apit → Safari → Sijainti: valitse "Kysy" tai "Salli". 4) Sulje sovellus kokonaan, avaa se uudelleen ja paina nappia. Jos kysely ei vieläkään tule Koti-valikon kuvakkeesta avattuna, avaa sama osoite Safarissa ja paina nappia siellä.';
async function paivitaGpsTila() {
  if (!$('#gpsTila')) return;
  let lupa = gps.lupa || '', selain = 'ei tietoa';
  try { if (navigator.permissions && navigator.permissions.query) { selain = (await navigator.permissions.query({ name: 'geolocation' })).state || selain; if (selain !== 'ei tietoa') lupa = selain; } } catch (x) { }
  const el = $('#gpsTila'); if (!el) return;
  const f = gps.viime, paalla = watchId != null, ios = onIos();
  el.textContent = !window.isSecureContext ? 'Sijainti toimii vain https-osoitteessa. Avaa sovellus sen julkaistusta osoitteesta.'
    : !navigator.geolocation ? 'Tämä selain ei tue paikannusta.'
      : gps.pyynto ? 'Pyydetään sijaintia… Vastaa laitteen kysymykseen "Salli".'
        : gps.eiVastaa && !f ? 'Laite ei näyttänyt lupakyselyä eikä vastannut sijaintipyyntöön. ' + (ios ? 'Näin käy, kun sijaintipalvelut ovat pois päältä tai Safarin sijaintilupa on estetty. ' + IOS_OHJE : 'Tarkista, että sijainti on päällä laitteen asetuksista ja sallittu tälle sivulle, ja paina nappia uudelleen.')
          : lupa === 'denied' ? 'Sijaintilupa on estetty. Selain ei kysy sitä uudelleen itsestään: salli sijainti laitteen asetuksista. ' + (ios ? IOS_OHJE : 'Ohje on napin alla.')
            : lupa === 'granted' ? 'Sijaintilupa on annettu. ' + (paalla ? (f ? 'GPS on päällä, tarkkuus ±' + Math.round(f.acc || 0) + ' m.' : 'GPS on päällä, haetaan sijaintia…') : 'GPS ei ole päällä – käynnistä se napista.')
              : paalla ? 'GPS on käynnistetty' + (f ? ', tarkkuus ±' + Math.round(f.acc || 0) + ' m.' : ', haetaan sijaintia…') + (gps.virhe ? ' ' + gps.virhe : '')
                : 'Sijaintilupaa ei ole vielä annettu. Paina nappia, niin laite kysyy luvan.';
  // tekniset tiedot vianselvitystä varten
  let t = $('#gpsTiedot'); if (!t) { t = document.createElement('div'); t.className = 'pieni'; t.id = 'gpsTiedot'; el.after(t); }
  const koti = (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
  t.textContent = 'Tekniset tiedot: suojattu yhteys ' + (window.isSecureContext ? 'kyllä' : 'ei') + ' · selaimen lupatila ' + ({ granted: 'sallittu', denied: 'estetty', prompt: 'kysytään' }[selain] || selain) + ' · avattu Koti-valikosta ' + (koti ? 'kyllä' : 'ei') + ' · laite ' + (ios ? 'iPad tai iPhone' : 'muu') + (gps.viimeVirhe ? ' · viimeisin vastaus: ' + gps.viimeVirhe : '');
}
// Pyytää sijaintiluvan suoraan napin painalluksesta (selain näyttää lupakyselyn vain käyttäjän toiminnasta) ja käynnistää seurannan.
// Jos laite ei vastaa 10 sekunnissa mitään, näytetään ohje: iOS ei kutsu virhekäsittelijää, kun kysely jää näyttämättä.
function gpsLupa() {
  if (!window.isSecureContext || !navigator.geolocation) { paivitaGpsTila(); ilmoita(!window.isSecureContext ? 'Sijainti toimii vain https-osoitteessa.' : 'Tämä selain ei tue paikannusta.'); return; }
  const pyynto = gps.pyynto = Date.now(); gps.eiVastaa = false; gps.viimeVirhe = ''; paivitaGpsTila();
  const vastasi = () => { if (gps.pyynto === pyynto) gps.pyynto = 0; gps.eiVastaa = false; };
  setTimeout(() => { if (gps.pyynto !== pyynto) return; gps.pyynto = 0; gps.eiVastaa = true; ilmoita('Laite ei näyttänyt lupakyselyä. Katso ohje Sijainti-kortista.'); paivitaGpsTila(); }, 10000);
  navigator.geolocation.getCurrentPosition(p => {
    vastasi(); gps.lupa = 'granted'; seurantaPaalle(true);
    let t = p.timestamp; if (!t || Math.abs(t - Date.now()) > 864e5) t = Date.now();
    fix({ t, lat: p.coords.latitude, lon: p.coords.longitude, acc: p.coords.accuracy, sog: p.coords.speed, cog: p.coords.heading });
    ilmoita('Sijaintilupa on kunnossa ja GPS on päällä.'); paivitaGpsTila();
  }, err => {
    vastasi(); gps.viimeVirhe = 'virhe ' + err.code + (err.message ? ' (' + String(err.message).slice(0, 60) + ')' : '');
    if (err.code === 1) { gps.lupa = 'denied'; gps.virhe = 'Sijaintilupa puuttuu.'; ilmoita('Sijaintilupa on estetty. Salli sijainti laitteen asetuksista – ohje on Sijainti-kortissa.'); }
    else { gps.lupa = 'granted'; seurantaPaalle(true); ilmoita('Lupa on kunnossa, mutta sijaintia ei saatu juuri nyt. Kokeile ulkona tai ikkunan vieressä.'); }      // lupa on, signaali puuttuu: seuranta jää yrittämään
    paivitaGpsTila();
  }, { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 });
}
// Näyttö pidetään päällä seurannan ajan: useimmat puhelimet katkaisevat selaimen paikannuksen, kun näyttö sammuu.
async function naytto(paalle) {
  try {
    if (paalle && 'wakeLock' in navigator && document.visibilityState === 'visible') lukko = await navigator.wakeLock.request('screen');
    else if (!paalle && lukko) { await lukko.release(); lukko = null; }
  } catch (x) { lukko = null; }
}

// ---------- sää (Open-Meteo, mallidataa) ----------
async function paivitaSaat() {
  if (saaKaynnissa || !navigator.onLine || !T.saajono.length) return;
  saaKaynnissa = true;
  try {
    for (const id of [...T.saajono]) {
      const m = matkat.find(x => x.id === id);
      if (m && await haeSaa(m) === false) break;      // ei verkkoa: yritetään myöhemmin
      T.saajono = T.saajono.filter(x => x !== id);
    }
    await talletaT();
  } finally { saaKaynnissa = false; }
  if (nakyma === 'loki' || nakyma === 'yksi' || nakyma === 'lisaa') piirra();
}
async function haeSaa(m) {
  let p = m.k || m.a || m.b;
  if (!p) { const x = T.paikat.find(q => q.nimi && (q.nimi === m.mista || q.nimi === m.minne)); if (x) p = [x.lat, x.lon]; }
  if (!p) return true;
  const q = 'latitude=' + p[0].toFixed(2) + '&longitude=' + p[1].toFixed(2) + '&timezone=UTC&start_date=' + new Date(m.alku).toISOString().slice(0, 10) + '&end_date=' + new Date(m.loppu).toISOString().slice(0, 10);
  const vanha = Date.now() - m.alku > 80 * 864e5;
  try {
    const r = await fetch((vanha ? 'https://archive-api.open-meteo.com/v1/archive?' : 'https://api.open-meteo.com/v1/forecast?') + q + '&wind_speed_unit=ms&hourly=temperature_2m,wind_speed_10m,wind_direction_10m,wind_gusts_10m,precipitation');
    if (!r.ok) { window.__saaVirhe = r.status; return r.status === 400; }      // 400 = aikaväliä ei ole saatavilla; muut virheet yritetään myöhemmin uudelleen
    const h = (await r.json()).hourly;
    let aallot = null;
    try { const ra = await fetch('https://marine-api.open-meteo.com/v1/marine?' + q + '&hourly=wave_height'); if (ra.ok) { const ha = (await ra.json()).hourly; aallot = { time: ha.time, korkeus: ha.wave_height }; } } catch (x) { }
    m.saa = saaYhteenveto({ time: h.time, tuuli: h.wind_speed_10m, suunta: h.wind_direction_10m, puuska: h.wind_gusts_10m, lampo: h.temperature_2m, sade: h.precipitation }, aallot, m.alku, m.loppu);
    await DB.put('matkat', m);
    return true;
  } catch (x) { return false; }
}
const saaTeksti = s => !s ? '' : [s.tuuli != null ? n(s.tuuli, 0) + ' m/s ' + ilmansuunta(s.suunta) : '', s.aalto != null ? 'aalto ' + n(s.aalto) + ' m' : '', s.lampo != null ? n(s.lampo, 0) + ' °C' : ''].filter(Boolean).join(' · ');

// ---------- kartta ----------
// Traficom palauttaa kartoittamattomalta alueelta läpinäkyvän palan: sellainen tulkitaan puuttuvaksi.
function tyhjaKuva(im) {
  const c = tyhjaKuva.c || (tyhjaKuva.c = document.createElement('canvas').getContext('2d', { willReadFrequently: true }));
  c.canvas.width = c.canvas.height = 8; c.clearRect(0, 0, 8, 8); c.drawImage(im, 0, 0, 8, 8);
  const d = c.getImageData(0, 0, 8, 8).data; for (let i = 3; i < d.length; i += 4) if (d[i] > 8) return false;
  return true;
}
const rajaa = (v, a, b) => Math.max(a, Math.min(b, v));
const mx = (lon, z) => (lon + 180) / 360 * 256 * 2 ** z, my = (lat, z) => (1 - Math.asinh(Math.tan(lat * RAD)) / Math.PI) / 2 * 256 * 2 ** z;
const lonX = (x, z) => x / (256 * 2 ** z) * 360 - 180, latY = (y, z) => Math.atan(Math.sinh(Math.PI * (1 - 2 * y / (256 * 2 ** z)))) / RAD;

const KESKITA = '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="1.6" fill="currentColor"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/></svg>';

// Karttapalat: muisti -> laitteen tallennus -> verkko. Palauttaa kuvan, null (ei saatavilla) tai undefined (haku kesken).
const muisti = new Map();
function haeLaatta(K, z, x, y, lataa) {
  // lataa: true / undefined = laitteelta tai verkosta, 'db' = vain laitteelle tallennettu (ei verkkohakua), false = vain jo muistissa oleva
  const avain = K.id + '/' + z + '/' + x + '/' + y, vainDb = lataa === 'db'; let m = muisti.get(avain);
  // eiDb = palaa ei ole laitteella, verkosta ei ole vielä kysytty: täysi haku saa yrittää verkkoa
  if (m && !(m.eiDb && !vainDb && lataa !== false)) return m.im || (m.ei || m.eiDb ? null : undefined);
  if (lataa === false) return undefined;
  const dbKatsottu = !!m;
  if (m) m.eiDb = false; else { m = { im: null, ei: false, eiDb: false }; muisti.set(avain, m); }
  if (muisti.size > 900) { let i = 0; for (const k of muisti.keys()) { if (i++ >= 250) break; muisti.delete(k); } }
  const valmis = src => { const im = new Image(); im.onload = () => { if (src.startsWith('blob:')) { URL.revokeObjectURL(src); if (tyhjaKuva(im)) { m.ei = true; laattaSaapui(); return; } } m.im = im; laattaSaapui(); }; im.onerror = () => { m.ei = true; laattaSaapui(); }; im.src = src; };
  if (!K.talteen) { if (vainDb) { m.eiDb = true; return null; } if (navigator.onLine) valmis(K.url(z, x, y)); else m.ei = true; return m.ei ? null : undefined; }
  (async () => {
    let b = null;
    if (!dbKatsottu) try { b = await DB.get('laatat', avain); } catch (x) { }
    if (!b && vainDb) { m.eiDb = true; laattaSaapui(); return; }
    let tilapainen = false;
    if (!b && navigator.onLine) { b = await haeKuva(K.url(z, x, y)); if (b) DB.put('laatat', b, avain).catch(() => { }); else tilapainen = b === undefined; }
    if (b) valmis(URL.createObjectURL(b));
    else {
      m.ei = true; laattaSaapui();
      // palvelun tai yhteyden tilapäinen virhe: pala unohdetaan hetken päästä, jolloin se haetaan uudelleen, jos se on yhä näkyvissä
      if (tilapainen) setTimeout(() => { if (muisti.get(avain) === m) { muisti.delete(avain); laattaSaapui(); } }, 12000);
    }
  })();
  return undefined;
}
// Karttapalan haku verkosta. Palauttaa kuvan, null (palaa ei ole) tai undefined (tilapäinen virhe).
// Karttapalvelu vastaa ruuhkassa satunnaisesti virheellä 500: palvelinvirhe yritetään muutaman kerran uudelleen.
// Yhteysvirhe tai yli 9 sekunnin odotus (heikko verkko merellä) lopettaa heti, ellei sitkea = true (alueen lataus talteen).
async function haeKuva(url, yrityksia, sitkea) {
  for (let i = 0; i < (yrityksia || 4); i++) {
    if (i) await new Promise(ok => setTimeout(ok, 300 + 700 * i + Math.random() * 400));
    try {
      const r = await fetch(url, AbortSignal.timeout ? { signal: AbortSignal.timeout(sitkea ? 20000 : 9000) } : undefined);
      if (r.ok) return /^image/.test(r.headers.get('content-type') || '') ? await r.blob() : null;
      if (r.status < 500 && r.status !== 429 && r.status !== 408) return null;
    } catch (x) { if (!sitkea || !navigator.onLine) return undefined; }
  }
  return undefined;
}
function laattaSaapui() { for (const k of [kLive, kYksi]) if (k && k.cv.isConnected) k.pyyda(); }
// Alueen palat tasoilta z0..z1. b = {lo0, lo1, la0 (etelä), la1 (pohjoinen)}
function laattaLista(b, z0, z1) {
  const l = [];
  for (let z = z0; z <= z1; z++) { const n = 2 ** z - 1, f = v => rajaa(Math.floor(v / 256), 0, n);
    for (let x = f(mx(b.lo0, z)); x <= f(mx(b.lo1, z)); x++) for (let y = f(my(b.la1, z)); y <= f(my(b.la0, z)); y++) l.push([z, x, y]); }
  return l;
}

// Yksi karttanäkymä. v = {lat, lon, z, seuraa}: keskipiste ja zoomaus (z voi olla murtoluku, jolloin palat skaalataan).
class Kartta {
  constructor(cv, v) { this.cv = cv; this.v = v; this.pts = []; this.vene = null; this.onMuutos = null; this.raf = 0; this._kuuntele(); }
  sovita(pts) {
    const W = this.cv.clientWidth, H = this.cv.clientHeight, v = this.v;
    const la = pts.map(p => p[1]), lo = pts.map(p => p[2]), la0 = Math.min(...la), la1 = Math.max(...la), lo0 = Math.min(...lo), lo1 = Math.max(...lo);
    let z = kartta().maxZ; for (; z > 3; z--) if (mx(lo1, z) - mx(lo0, z) <= W - 60 && my(la0, z) - my(la1, z) <= H - 60) break;
    v.z = z; v.lon = (lo0 + lo1) / 2; v.lat = latY((my(la0, 0) + my(la1, 0)) / 2, 0);
  }
  pyyda() { if (!this.raf) this.raf = requestAnimationFrame(() => { this.raf = 0; this.piirra(); }); }
  siirra(dx, dy) { const v = this.v; v.lon = lonX(mx(v.lon, v.z) + dx, v.z); v.lat = rajaa(latY(my(v.lat, v.z) + dy, v.z), -80, 84); v.seuraa = false; this.pyyda(); if (this.onMuutos) this.onMuutos(); }
  // kx, ky = kohta, jonka ympäri zoomataan (sormien keskipiste); seuratessa aina veneen ympäri
  zoomaa(dz, kx, ky) {
    const v = this.v, W = this.cv.clientWidth, H = this.cv.clientHeight, z1 = rajaa(v.z + dz, 4, kartta().maxZ + 1.5);
    if (z1 === v.z) return;
    // Zoomataan sormien tai hiiren kohtaan. Venettä seurataan edelleen vain, jos kohta on veneen vieressä.
    if (kx != null && v.seuraa && Math.hypot(kx - W / 2, ky - H / 2) > 70) { v.seuraa = false; if (this.onMuutos) this.onMuutos(); }
    if (kx == null || v.seuraa) v.z = z1;
    else { const lon = lonX(mx(v.lon, v.z) + kx - W / 2, v.z), lat = latY(my(v.lat, v.z) + ky - H / 2, v.z); v.z = z1; v.lon = lonX(mx(lon, z1) - (kx - W / 2), z1); v.lat = latY(my(lat, z1) - (ky - H / 2), z1); }
    this.pyyda();
  }
  _kuuntele() {
    const cv = this.cv, os = new Map(); let veto = false;
    const kohta = e => { const r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    cv.addEventListener('pointerdown', e => { try { cv.setPointerCapture(e.pointerId); } catch (x) { } os.set(e.pointerId, kohta(e)); if (os.size === 1) veto = false; });
    cv.addEventListener('pointermove', e => {
      const ed = os.get(e.pointerId); if (!ed) return; const nyt = kohta(e);
      if (os.size === 1) {
        if (!veto && Math.hypot(nyt[0] - ed[0], nyt[1] - ed[1]) < 6) return;     // pelkkä napautus ei siirrä karttaa
        veto = true; this.siirra(ed[0] - nyt[0], ed[1] - nyt[1]);
      } else if (os.size === 2) {
        let t; for (const [id, p] of os) if (id !== e.pointerId) t = p;
        const d0 = Math.hypot(ed[0] - t[0], ed[1] - t[1]), d1 = Math.hypot(nyt[0] - t[0], nyt[1] - t[1]);
        if (!this.v.seuraa) this.siirra((ed[0] - nyt[0]) / 2, (ed[1] - nyt[1]) / 2);
        if (d0 > 10 && d1 > 10) this.zoomaa(Math.log2(d1 / d0), (nyt[0] + t[0]) / 2, (nyt[1] + t[1]) / 2);
      }
      os.set(e.pointerId, nyt);
    });
    const loppu = e => { os.delete(e.pointerId); };
    cv.addEventListener('pointerup', e => {
      if (os.size === 1 && !veto && napautusCb && this === kLive) { const k = kohta(e), v = this.v, W = cv.clientWidth, H = cv.clientHeight; napautusCb(latY(my(v.lat, v.z) + k[1] - H / 2, v.z), lonX(mx(v.lon, v.z) + k[0] - W / 2, v.z)); }
      else if (os.size === 1 && !veto && this === kLive) { const k = kohta(e); karttaNapautus(k[0], k[1]); }
      loppu(e);
    });
    cv.addEventListener('pointercancel', loppu);
    cv.addEventListener('wheel', e => { e.preventDefault(); const k = kohta(e); this.zoomaa(-e.deltaY / 300, k[0], k[1]); }, { passive: false });
  }
  piirra() {
    const cv = this.cv, v = this.v, K = kartta(), W = cv.clientWidth, H = cv.clientHeight; if (!W || !cv.isConnected) return;
    const dpr = window.devicePixelRatio || 1; cv.width = W * dpr; cv.height = H * dpr;
    const c = cv.getContext('2d'); c.scale(dpr, dpr);
    v.z = rajaa(v.z, 4, K.maxZ + 1.5);
    // Tarkempaan tasoon vaihdetaan jo hieman ennen puoliväliä, jotta kuva pysyy terävänä.
    const zi = rajaa(Math.round(v.z + .25), 3, K.maxZ), L = 256 * 2 ** (v.z - zi), ox = mx(v.lon, v.z) - W / 2, oy = my(v.lat, v.z) - H / 2, n = 2 ** zi; let piirretty = 0, tarkkoja = 0;
    for (let tx = Math.floor(ox / L); tx <= Math.floor((ox + W) / L); tx++) for (let ty = Math.floor(oy / L); ty <= Math.floor((oy + H) / L); ty++) {
      if (tx < 0 || ty < 0 || tx >= n || ty >= n) continue;
      const dx = tx * L - ox, dy = ty * L - oy, im = haeLaatta(K, zi, tx, ty);
      if (im) { c.drawImage(im, dx, dy, L + .6, L + .6); piirretty++; }
      // Pala puuttuu tai on vielä tulossa: näytetään karkeampi taso suurennettuna, jos sellainen on.
      else for (let d = 1; d <= 6 && zi - d >= 3; d++) {
        // Kun tarkin pala on vielä tulossa verkosta, karkeampi taso haetaan heti laitteen tallennuksesta ('db') odottamatta verkkoa.
        const p = haeLaatta(K, zi - d, tx >> d, ty >> d, im === null ? true : 'db');
        if (p) { const k = 256 / 2 ** d; c.drawImage(p, (tx - ((tx >> d) << d)) * k, (ty - ((ty >> d) << d)) * k, k, k, dx, dy, L + .6, L + .6); piirretty++; break; }
        if (p === undefined) break;
      }
      // Lähelle zoomattaessa päälle piirretään tarkempi satamakartta siellä, missä sellainen on.
      if (K.paalle && zi >= K.paalle.minZ) { const s = haeLaatta(K.paalle, zi, tx, ty); if (s) { c.drawImage(s, dx, dy, L + .6, L + .6); tarkkoja++; } }
    }
    cv.dataset.laatat = piirretty; cv.dataset.tarkkoja = tarkkoja;
    const X = lon => mx(lon, v.z) - ox, Y = lat => my(lat, v.z) - oy, pts = this.pts;
    const piste = (p, vari) => { c.beginPath(); c.arc(X(p[2]), Y(p[1]), 6, 0, 7); c.fillStyle = vari; c.fill(); c.lineWidth = 2.5; c.strokeStyle = '#fff'; c.stroke(); };
    c.lineJoin = c.lineCap = 'round';
    // Suunniteltu reitti: sininen väylää pitkin, oranssi katkoviiva väylän ulkopuolella.
    const R = this.reitti;
    if (R && R.length > 1) {
      const veda = (ulkona, w, vari, katko) => { c.setLineDash(katko); c.lineWidth = w; c.strokeStyle = vari; c.beginPath(); for (let i = 1; i < R.length; i++) { if ((R[i][2] < 0) !== ulkona) continue; c.moveTo(X(R[i - 1][1]), Y(R[i - 1][0])); c.lineTo(X(R[i][1]), Y(R[i][0])); } c.stroke(); };
      veda(false, 8, '#fff', []); veda(true, 7, '#fff', []); veda(false, 4.5, '#1565c0', []); veda(true, 4, '#e8590c', [1, 9]); c.setLineDash([]);
      // Reitin seuranta: jo ajettu osuus harmaana, seuraava käännös keltaisella renkaalla ja sivussa ollessa viiva veneestä reitille.
      const q = this.reittiKohta;
      if (q && q.i < R.length) {
        c.lineWidth = 4.5; c.strokeStyle = '#9aa7b1'; c.beginPath(); c.moveTo(X(R[0][1]), Y(R[0][0])); for (let i = 1; i < q.i; i++) c.lineTo(X(R[i][1]), Y(R[i][0])); c.lineTo(X(q.lon), Y(q.lat)); c.stroke();
        if (q.kaannos) { c.beginPath(); c.arc(X(q.kaannos.lon), Y(q.kaannos.lat), 8, 0, 7); c.fillStyle = '#ffd43b'; c.fill(); c.lineWidth = 2.5; c.strokeStyle = '#12222f'; c.stroke(); }
        if (q.etaisyys > 40 && this.vene) { c.setLineDash([6, 6]); c.lineWidth = 2.5; c.strokeStyle = '#e01b24'; c.beginPath(); c.moveTo(X(this.vene.lon), Y(this.vene.lat)); c.lineTo(X(q.lon), Y(q.lat)); c.stroke(); c.setLineDash([]); }
      }
      const a = R[0], b = R[R.length - 1];
      c.beginPath(); c.arc(X(a[1]), Y(a[0]), 5, 0, 7); c.fillStyle = '#fff'; c.fill(); c.lineWidth = 3; c.strokeStyle = '#1565c0'; c.stroke();
      c.beginPath(); c.arc(X(b[1]), Y(b[0]), 9, 0, 7); c.fillStyle = '#1565c0'; c.fill(); c.lineWidth = 3; c.strokeStyle = '#fff'; c.stroke(); c.beginPath(); c.arc(X(b[1]), Y(b[0]), 3, 0, 7); c.fillStyle = '#fff'; c.fill();
    }
    if (pts.length > 1) for (const [w, vari] of [[7, '#fff'], [4, '#e01b24']]) { c.lineWidth = w; c.strokeStyle = vari; c.beginPath(); pts.forEach((p, i) => i ? c.lineTo(X(p[2]), Y(p[1])) : c.moveTo(X(p[2]), Y(p[1]))); c.stroke(); }
    if (pts.length) piste(pts[0], '#1f8a4c');
    if (this.lisat) { this.lisat(c, X, Y, W, H, v.z); lisatAjasta(); }
    const b = this.vene;
    if (!b) { if (pts.length) piste(pts[pts.length - 1], '#c0392b'); return; }
    // Oma sijainti: sininen piste ja kulkusuunnan nuoli.
    c.save(); c.translate(X(b.lon), Y(b.lat));
    if (b.suunta != null && !b.himmea) { c.rotate(b.suunta * RAD); c.beginPath(); c.moveTo(0, -24); c.lineTo(9, -8); c.lineTo(-9, -8); c.closePath(); c.fillStyle = '#1565c0'; c.fill(); c.lineWidth = 2; c.strokeStyle = '#fff'; c.stroke(); }
    c.beginPath(); c.arc(0, 0, 9, 0, 7); c.fillStyle = b.himmea ? '#7d8a94' : '#1565c0'; c.fill(); c.lineWidth = 3; c.strokeStyle = '#fff'; c.stroke();
    c.restore();
  }
}
const seuraaMerkki = () => { const b = $('#lKarttaK'); if (b) b.classList.toggle('on', lv.seuraa); };
function karttaUudelleen() {
  if (nakyma === 'yksi' && kYksi && kYksi.cv.isConnected) kYksi.piirra();
  if (nakyma === 'kartta') { lk = null; liveKartta(); }
}

function liveKartta() {
  const cv = $('#lKartta'); if (!cv) return;
  if (!kLive || kLive.cv !== cv) { kLive = new Kartta(cv, lv); kLive.onMuutos = seuraaMerkki; lk = null; }
  kLive.reitti = null; kLive.lisat = piirraLisat;
  const f = gps.viime, paalla = watchId != null || tal.tila === 'matka';
  if (!f || !paalla) {            // ei sijaintia juuri nyt: viimeisin tunnettu paikka, muuten Suomenlahti
    if (lk) return; lk = { tyhja: true };
    const s = T.sij;
    if (s && lv.alussa) { lv.z = 14; lv.alussa = false; }
    if (s && lv.seuraa) { lv.lat = s[0]; lv.lon = s[1]; }
    kLive.pts = []; kLive.vene = s ? { lat: s[0], lon: s[1], himmea: true, suunta: kulku } : null;
    kLive.piirra(); seuraaMerkki(); return;
  }
  const ed = lk && !lk.tyhja ? lk : null;
  if (ed && (Date.now() - ed.aika < 2000 || etaisyys(ed.lat, ed.lon, f.lat, f.lon) < 10)) return;
  if (f.cog != null && !isNaN(f.cog) && f.sog > 0.5) kulku = f.cog;
  else if (ed) kulku = (Math.atan2(Math.sin((f.lon - ed.lon) * RAD) * Math.cos(f.lat * RAD), Math.cos(ed.lat * RAD) * Math.sin(f.lat * RAD) - Math.sin(ed.lat * RAD) * Math.cos(f.lat * RAD) * Math.cos((f.lon - ed.lon) * RAD)) / RAD + 360) % 360;
  lk = { aika: Date.now(), lat: f.lat, lon: f.lon }; T.sij = [f.lat, f.lon];
  if (lv.alussa) { lv.z = 14; lv.alussa = false; }
  if (lv.seuraa) { lv.lat = f.lat; lv.lon = f.lon; }
  kLive.pts = tal.m ? tal.m.pisteet.concat([[f.t, f.lat, f.lon, f.sog]]) : [];
  kLive.vene = { lat: f.lat, lon: f.lon, suunta: kulku };
  kLive.piirra(); seuraaMerkki();
}

// Nopeuskäyrä: jokaisen reittipisteen nopeus kilometreinä tunnissa ajan funktiona.
function piirraKayra(cv, pts) {
  const dpr = window.devicePixelRatio || 1, W = cv.clientWidth, H = cv.clientHeight; cv.width = W * dpr; cv.height = H * dpr;
  const c = cv.getContext('2d'); c.scale(dpr, dpr);
  const tyyli = getComputedStyle(document.documentElement), vari = k => tyyli.getPropertyValue(k).trim();
  const kn = pts.map(p => nopeus(p[3] || 0)), suurin = Math.max(...kn, 1), askel = suurin > 40 ? 20 : suurin > 20 ? 10 : suurin > 8 ? 5 : suurin > 4 ? 2 : 1, ylin = Math.ceil(suurin / askel) * askel;
  const vas = 30, ala = 18, yla = 6, t0 = pts[0][0], t1 = Math.max(pts[pts.length - 1][0], t0 + 1);
  const X = t => vas + (t - t0) / (t1 - t0) * (W - vas - 4), Y = v => yla + (1 - v / ylin) * (H - yla - ala);
  c.font = '11px system-ui,sans-serif'; c.fillStyle = vari('--himmea'); c.strokeStyle = vari('--viiva'); c.lineWidth = 1; c.textBaseline = 'middle';
  for (let v = 0; v <= ylin; v += askel) { c.beginPath(); c.moveTo(vas, Y(v)); c.lineTo(W - 4, Y(v)); c.stroke(); c.textAlign = 'right'; c.fillText(v, vas - 6, Y(v)); }
  c.textBaseline = 'alphabetic'; c.textAlign = 'left'; c.fillText(klo(t0), vas, H - 3); c.textAlign = 'right'; c.fillText(klo(t1), W - 4, H - 3);
  // yli 2 min aukko (GPS-katko) katkaisee käyrän
  const osat = []; let osa = [];
  pts.forEach((p, i) => { if (i && p[0] - pts[i - 1][0] > 120000) { osat.push(osa); osa = []; } osa.push([X(p[0]), Y(kn[i])]); }); osat.push(osa);
  for (const s of osat) {
    if (s.length < 2) continue;
    c.beginPath(); s.forEach((q, i) => i ? c.lineTo(q[0], q[1]) : c.moveTo(q[0], q[1]));
    c.lineWidth = 2; c.lineJoin = 'round'; c.strokeStyle = vari('--korostus'); c.stroke();
    c.lineTo(s[s.length - 1][0], Y(0)); c.lineTo(s[0][0], Y(0)); c.closePath(); c.globalAlpha = .16; c.fillStyle = vari('--korostus'); c.fill(); c.globalAlpha = 1;
  }
  cv.dataset.pisteita = pts.length;
}

// ---------- tuuli kartalla (Open-Meteo) ----------
const lisa = { tuuli: null, tuuliHaku: 0, tunti: 0, ais: null, aisAika: 0, aisHaku: 0, aisNimet: null, aisNimetAika: 0, aisNakyma: null, satamat: null, satamaHaku: false, satamaVirhe: '', osumat: [], ajastin: 0 };
const TUNNIT = [0, 3, 6, 12, 24];
const nakymaRajat = k => { const W = k.cv.clientWidth, H = k.cv.clientHeight, v = k.v, x = mx(v.lon, v.z), y = my(v.lat, v.z); return { lo0: lonX(x - W / 2, v.z), lo1: lonX(x + W / 2, v.z), la1: latY(y - H / 2, v.z), la0: latY(y + H / 2, v.z) }; };
// Onko karttaa siirretty tai zoomattu niin paljon, että tiedot pitää hakea uudelleen?
const siirtynyt = n => { if (!n || !kLive) return true; const v = lv, W = kLive.cv.clientWidth, H = kLive.cv.clientHeight; return Math.abs(v.z - n.z) > 0.8 || Math.hypot(mx(v.lon, v.z) - mx(n.lon, v.z), my(v.lat, v.z) - my(n.lat, v.z)) > 0.35 * Math.min(W, H); };
const nakymaNyt = () => ({ lat: lv.lat, lon: lv.lon, z: lv.z });

async function tuuliHae() {
  if (lisa.tuuliHaku || !kLive) return; lisa.tuuliHaku = 1;
  const b = nakymaRajat(kLive), nak = nakymaNyt(), SAR = 4, RIV = 5, la = [], lo = [];
  for (let r = 0; r < RIV; r++) for (let s = 0; s < SAR; s++) { la.push((b.la1 - (r + .5) / RIV * (b.la1 - b.la0)).toFixed(3)); lo.push((b.lo0 + (s + .5) / SAR * (b.lo1 - b.lo0)).toFixed(3)); }
  try {
    const q = 'latitude=' + la.join(',') + '&longitude=' + lo.join(',') + '&forecast_hours=25&timezone=UTC';
    const [r1, r2] = await Promise.all([fetch('https://api.open-meteo.com/v1/forecast?' + q + '&wind_speed_unit=ms&hourly=wind_speed_10m,wind_direction_10m,wind_gusts_10m,temperature_2m,precipitation'), fetch('https://marine-api.open-meteo.com/v1/marine?' + q + '&hourly=wave_height').catch(() => null)]);
    if (!r1.ok) throw new Error(r1.status); let j = await r1.json(); if (!Array.isArray(j)) j = [j];
    let m = null; if (r2 && r2.ok) { m = await r2.json(); if (!Array.isArray(m)) m = [m]; }
    lisa.tuuli = { nakyma: nak, aika: Date.now(), ajat: j[0].hourly.time.map(s => Date.parse(s + ':00Z')),
      p: j.map((x, i) => ({ lat: +la[i], lon: +lo[i], nop: x.hourly.wind_speed_10m, suu: x.hourly.wind_direction_10m, pus: x.hourly.wind_gusts_10m, lam: x.hourly.temperature_2m, sade: x.hourly.precipitation, aalto: m && m[i] && m[i].hourly ? m[i].hourly.wave_height : null })) };
  } catch (x) { lisa.tuuliVirhe = Date.now(); } finally { lisa.tuuliHaku = 0; }
  laattaSaapui();
}

let aaniK = null;
function halyta(teksti) {
  ilmoita(teksti);
  try { if (navigator.vibrate) navigator.vibrate([300, 150, 300]); } catch (x) { }
  try {      // kaksi lyhyttä piippausta; selain sallii äänen vasta, kun sivua on kosketettu
    aaniK = aaniK || new (window.AudioContext || window.webkitAudioContext)();
    for (const alku of [0, 0.3]) { const o = aaniK.createOscillator(), g = aaniK.createGain(); o.frequency.value = 880; g.gain.value = 0.25; o.connect(g); g.connect(aaniK.destination); o.start(aaniK.currentTime + alku); o.stop(aaniK.currentTime + alku + 0.2); }
  } catch (x) { }
}
