// Metsästäjä Pron laskenta: ei koske sivuun eikä tallennukseen, joten sama tiedosto toimii myös testeissä (Node).
// Alkuosa on koottu Kippari Pron tiedostosta ydin.js (node testi\rakenna-pohja.js), loppuosa on tiedostosta testi\ydin-lisa.js.
'use strict';

const MPK = 1852;            // metriä meripeninkulmassa
const SOLMU = 1852 / 3600;   // m/s yhdessä solmussa
const RAD = Math.PI / 180;

function etaisyys(lat1, lon1, lat2, lon2) {
  const a = Math.sin((lat2 - lat1) * RAD / 2) ** 2 + Math.cos(lat1 * RAD) * Math.cos(lat2 * RAD) * Math.sin((lon2 - lon1) * RAD / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(a));
}
const valiM = (a, b) => etaisyys(a.lat, a.lon, b.lat, b.lon);

// Matkan tallennin. Sille syötetään GPS-havaintoja {t, lat, lon, acc, sog}; se päättää itse milloin matka alkaa ja päättyy.
class Tallennin {
  constructor(as) {
    this.as = Object.assign({
      auto: true,
      alkuM: 100,        // näin kauas lähtöpaikasta ennen kuin matka alkaa
      alkuNopeus: 1.5,   // m/s (noin 3 solmua) – kävely laiturilla ei saa aloittaa matkaa
      alkuVarmaM: 300,   // näin kaukana matka alkaa hitaastikin
      pysM: 50,          // pysähdys = pysytään tämän säteen sisällä
      pysMin: 15,        // ... näin monta minuuttia
      minM: 200,         // lyhyempi automaattinen matka hylätään
      tarkkuus: 35,      // epätarkemmat havainnot ohitetaan (m)
      valiM: 10, valiS: 30
    }, as || {});
    this.tila = 'lepo'; this.ankkuri = null; this.osumat = 0; this.viime = null; this.m = null; this.pys = null; this.ref = null;
  }
  aloita(t, f) {
    this.tila = 'matka'; this.osumat = 0;
    this.m = { alku: t, loppu: null, pisteet: [], matka: 0, liike: 0, max: 0, katkot: 0 };
    this.pys = null; this.ref = null;
    if (f) this._piste(f, true);
  }
  lopeta(t, kuva) {
    if (this.tila !== 'matka') return null;
    const m = this.m;
    m.loppu = Math.max(m.alku, t || (this.viime ? this.viime.t : m.alku));
    m.pisteet = m.pisteet.filter(p => p[0] <= m.loppu);
    if (kuva) { m.matka = kuva.matka; m.liike = kuva.liike; }
    const v = this.viime;
    this.tila = 'lepo'; this.m = null; this.pys = null; this.ref = null; this.osumat = 0;
    this.ankkuri = v ? { t: v.t, lat: v.lat, lon: v.lon } : null;
    return m;
  }
  _piste(f, pakko) {
    const m = this.m, p = m.pisteet[m.pisteet.length - 1];
    if (!this.ref) this.ref = { lat: f.lat, lon: f.lon };
    const dr = valiM(this.ref, f);
    if (dr >= this.as.valiM) { m.matka += dr; this.ref = { lat: f.lat, lon: f.lon }; }
    if (pakko || !p || etaisyys(p[1], p[2], f.lat, f.lon) >= this.as.valiM || f.t - p[0] >= this.as.valiS * 1000)
      m.pisteet.push([f.t, +f.lat.toFixed(6), +f.lon.toFixed(6), +(f.sog || 0).toFixed(2)]);
  }
  // Palauttaa null tai {tapahtuma:'alkoi'|'paattyi'|'hylatty', matka}
  syota(f) {
    if (f.acc != null && f.acc > this.as.tarkkuus) return null;
    const ed = this.viime; let sog = f.sog, dt = 0;
    if (ed) { dt = (f.t - ed.t) / 1000; if (dt <= 0) return null; }
    if (sog == null || isNaN(sog) || sog < 0) sog = ed ? valiM(ed, f) / dt : 0;
    f = { t: f.t, lat: f.lat, lon: f.lon, acc: f.acc, sog, cog: f.cog };
    this.viime = f;

    if (this.tila === 'lepo') {
      if (!this.ankkuri) { this.ankkuri = { t: f.t, lat: f.lat, lon: f.lon }; return null; }
      const d = valiM(this.ankkuri, f);
      if (d <= this.as.alkuM) { this.ankkuri.t = f.t; this.osumat = 0; return null; }   // yhä lähtöpaikalla
      if (!this.as.auto) return null;
      if (sog >= this.as.alkuNopeus || d >= this.as.alkuVarmaM) {
        if (++this.osumat >= 2) {
          const a = this.ankkuri;
          this.aloita(a.t, { t: a.t, lat: a.lat, lon: a.lon, sog: 0 });
          this._piste(f);
          this.m.liike = (f.t - a.t) / 1000;      // lähtöpaikalta poistumiseen kulunut aika oli jo ajoa
          this.pys = { t: f.t, lat: f.lat, lon: f.lon, matka: this.m.matka, liike: this.m.liike };
          return { tapahtuma: 'alkoi' };
        }
      } else this.osumat = 0;
      return null;
    }

    const m = this.m;
    if (dt > 120) m.katkot++;
    else { if (sog > 0.5) m.liike += dt; if (dt <= 30 && sog > m.max) m.max = sog; }
    this._piste(f);
    if (!this.pys || valiM(this.pys, f) > this.as.pysM) this.pys = { t: f.t, lat: f.lat, lon: f.lon, matka: m.matka, liike: m.liike };
    else if (this.as.auto && f.t - this.pys.t >= this.as.pysMin * 60000) {
      const valmis = this.lopeta(this.pys.t, this.pys);
      return { tapahtuma: valmis.matka < this.as.minM ? 'hylatty' : 'paattyi', matka: valmis };
    }
    return null;
  }
  vie() { return { tila: this.tila, ankkuri: this.ankkuri, viime: this.viime, m: this.m, pys: this.pys, ref: this.ref }; }
  tuo(o) { Object.assign(this, { tila: o.tila, ankkuri: o.ankkuri, viime: o.viime, m: o.m, pys: o.pys, ref: o.ref, osumat: 0 }); }
}

function lahinPaikka(paikat, lat, lon) {
  let paras = null, pd = Infinity;
  for (const p of paikat || []) { const d = etaisyys(p.lat, p.lon, lat, lon); if (d <= (p.sade || 400) && d < pd) { paras = p; pd = d; } }
  return paras;
}

// Kulutus täysien tankkausten väliltä: litrat / moottoritunnit ja litrat / mpk.

const ILMANSUUNNAT = ['P', 'KO', 'I', 'KA', 'E', 'LO', 'L', 'LU'];
const ilmansuunta = aste => aste == null ? '' : ILMANSUUNNAT[Math.round(((aste % 360) + 360) % 360 / 45) % 8];

// Tuntidatasta matkan ajan yhteenveto. saa = {time[], tuuli[], suunta[], puuska[], lampo[], sade[]}, aallot = {time[], korkeus[]}
function saaYhteenveto(saa, aallot, alku, loppu) {
  const H = 3600000, a = Math.floor(alku / H) * H, b = Math.max(a, Math.ceil(loppu / H) * H);
  const valitse = (ajat) => ajat.map((s, i) => [Date.parse(s + ':00Z'), i]).filter(x => x[0] >= a && x[0] <= b).map(x => x[1]);
  const ka = x => x.length ? x.reduce((p, c) => p + c, 0) / x.length : null;
  const luvut = (taulu, ix) => ix.map(i => taulu && taulu[i]).filter(v => v != null && !isNaN(v));
  const ix = valitse(saa.time);
  if (!ix.length) return null;
  const tuuli = luvut(saa.tuuli, ix), suunnat = luvut(saa.suunta, ix), puuska = luvut(saa.puuska, ix), sade = luvut(saa.sade, ix);
  let suunta = null;
  if (suunnat.length) { const x = ka(suunnat.map(s => Math.sin(s * RAD))), y = ka(suunnat.map(s => Math.cos(s * RAD))); suunta = Math.round((Math.atan2(x, y) / RAD + 360) % 360); }
  let aalto = null;
  if (aallot && aallot.time) { const k = luvut(aallot.korkeus, valitse(aallot.time)); if (k.length) aalto = Math.max(...k); }
  const r1 = v => v == null ? null : Math.round(v * 10) / 10;
  return { tuuli: r1(ka(tuuli)), puuska: puuska.length ? r1(Math.max(...puuska)) : null, suunta, lampo: r1(ka(luvut(saa.lampo, ix))), sade: sade.length ? r1(sade.reduce((p, c) => p + c, 0)) : null, aalto: r1(aalto) };
}

function gpx(nimi, pisteet) {
  const x = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  return '<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="Kippari Pro" xmlns="http://www.topografix.com/GPX/1/1">\n<trk><name>' + x(nimi) + '</name><trkseg>\n' +
    pisteet.map(p => '<trkpt lat="' + p[1] + '" lon="' + p[2] + '"><time>' + new Date(p[0]).toISOString() + '</time><extensions><speed>' + (p[3] || 0) + '</speed></extensions></trkpt>').join('\n') + '\n</trkseg></trk>\n</gpx>\n';
}

const suuntima = (la1, lo1, la2, lo2) => (Math.atan2(Math.sin((lo2 - lo1) * RAD) * Math.cos(la2 * RAD), Math.cos(la1 * RAD) * Math.sin(la2 * RAD) - Math.sin(la1 * RAD) * Math.cos(la2 * RAD) * Math.cos((lo2 - lo1) * RAD)) / RAD + 360) % 360;

const kulmaEro = (a, b) => ((b - a + 540) % 360) - 180;      // suunnasta a suuntaan b, + = oikealle

// GPS-jäljen yksinkertaistus (Douglas–Peucker): jättää pois pisteet, jotka ovat alle tol metrin päässä jäljelle jäävästä viivasta. p = [[lat, lon], ...]
function yksinkertaista(p, tol) {
  if (p.length < 3) return p.slice();
  const KX = 111320 * Math.cos(p[0][0] * RAD), KY = 110574, pida = new Uint8Array(p.length), pino = [[0, p.length - 1]]; pida[0] = pida[p.length - 1] = 1;
  while (pino.length) {
    const [a, b] = pino.pop(), ax = p[a][1] * KX, ay = p[a][0] * KY, dx = p[b][1] * KX - ax, dy = p[b][0] * KY - ay; let m = -1, md = tol;
    for (let i = a + 1; i < b; i++) { const x = p[i][1] * KX, y = p[i][0] * KY, t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1))), d = Math.hypot(ax + t * dx - x, ay + t * dy - y); if (d > md) { md = d; m = i; } }
    if (m >= 0) { pida[m] = 1; pino.push([a, m], [m, b]); }
  }
  return p.filter((x, i) => pida[i]);
}

// ---------- metsästyksen laskenta ----------
// Auringon nousu ja lasku sekä siviilihämärä (aurinko 6 astetta horisontin alla) annetun päivän aikana.
// Likiarvokaava (ns. sunrise equation), tarkkuus noin pari minuuttia. t = jokin hetki halutulta paikalliselta päivältä (ms).
// Palauttaa ajat millisekunteina; null = aurinko ei nouse tai laske sinä päivänä (kaamos tai yötön yö).
function aurinko(lat, lon, t) {
  const d = new Date(t), nPv = Math.round(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), 12) / 864e5 + 2440587.5 - 2451545.0), J = nPv - lon / 360;
  const M = ((357.5291 + 0.98560028 * J) % 360 + 360) % 360, C = 1.9148 * Math.sin(M * RAD) + 0.02 * Math.sin(2 * M * RAD) + 0.0003 * Math.sin(3 * M * RAD);
  const L = ((M + C + 180 + 102.9372) % 360 + 360) % 360, keski = 2451545.0 + J + 0.0053 * Math.sin(M * RAD) - 0.0069 * Math.sin(2 * L * RAD);
  const sinD = Math.sin(L * RAD) * Math.sin(23.4397 * RAD), cosD = Math.cos(Math.asin(sinD));
  const ms = jd => Math.round((jd - 2440587.5) * 864e5);
  const kulma = korkeus => { const c = (Math.sin(korkeus * RAD) - Math.sin(lat * RAD) * sinD) / (Math.cos(lat * RAD) * cosD); return c < -1 || c > 1 ? null : Math.acos(c) / RAD; };
  const w = kulma(-0.833), h = kulma(-6);
  return { keskipaiva: ms(keski), nousu: w == null ? null : ms(keski - w / 360), lasku: w == null ? null : ms(keski + w / 360), hamaraAlku: h == null ? null : ms(keski - h / 360), hamaraLoppu: h == null ? null : ms(keski + h / 360) };
}
// Monikulmiot: p = [[lat, lon], ...] (kehää ei tarvitse sulkea).
function pisteMonikulmiossa(lat, lon, p) {
  let s = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) { const yi = p[i][0], xi = p[i][1], yj = p[j][0], xj = p[j][1]; if ((yi > lat) !== (yj > lat) && lon < (xj - xi) * (lat - yi) / (yj - yi) + xi) s = !s; }
  return s;
}
// Lyhin etäisyys metreinä pisteestä monikulmion reunaan.
function etaisyysReunaan(lat, lon, p) {
  const KX = 111320 * Math.cos(lat * RAD), KY = 110574, px = lon * KX, py = lat * KY; let paras = Infinity;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const ax = p[j][1] * KX, ay = p[j][0] * KY, dx = p[i][1] * KX - ax, dy = p[i][0] * KY - ay, t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1)));
    paras = Math.min(paras, Math.hypot(ax + t * dx - px, ay + t * dy - py));
  }
  return paras;
}
// Monikulmion pinta-ala hehtaareina ja piirin pituus metreinä.
function alueMitat(p) {
  if (p.length < 3) return { ha: 0, piiri: 0 };
  const KX = 111320 * Math.cos(p[0][0] * RAD), KY = 110574; let ala = 0, piiri = 0;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) { ala += (p[j][1] * KX) * (p[i][0] * KY) - (p[i][1] * KX) * (p[j][0] * KY); piiri += etaisyys(p[j][0], p[j][1], p[i][0], p[i][1]); }
  return { ha: Math.abs(ala) / 2 / 10000, piiri };
}
// Saaliiden ja havaintojen yhteenveto lajeittain: [{laji, saalis, havainto}], suurin saalis ensin.
function lajiTilasto(lista) {
  const m = new Map();
  for (const x of lista) { let r = m.get(x.laji); if (!r) m.set(x.laji, r = { laji: x.laji, saalis: 0, havainto: 0 }); r[x.tyyppi === 'saalis' ? 'saalis' : 'havainto'] += x.maara || 1; }
  return [...m.values()].sort((a, b) => b.saalis - a.saalis || b.havainto - a.havainto || a.laji.localeCompare(b.laji, 'fi'));
}

if (typeof module !== 'undefined') module.exports = { MPK, SOLMU, RAD, etaisyys, Tallennin, lahinPaikka, ilmansuunta, saaYhteenveto, gpx, suuntima, kulmaEro, yksinkertaista, aurinko, pisteMonikulmiossa, etaisyysReunaan, alueMitat, lajiTilasto };
