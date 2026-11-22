// Tallentaa sovelluksen tiedostot puhelimeen, jotta se avautuu ilman verkkoa. Sää-, kartta- ja väylähakuihin ei kosketa.
// Verkko ensin: kun yhteys on, käytetään aina uusinta versiota. Talteen tallennettu versio on varalla ilman verkkoa.
const NIMI = 'metsastaja-v1';
const TIEDOSTOT = ['./', 'index.html', 'app.css', 'js/ydin.js', 'js/pohja.js', 'js/sovellus.js', 'manifest.webmanifest', 'kuvake.svg', 'kuvake-192.png', 'kuvake-512.png', 'kuvake-180.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(NIMI).then(c => c.addAll(TIEDOSTOT)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(k => Promise.all(k.filter(x => x !== NIMI).map(x => caches.delete(x)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return;
  e.respondWith(caches.open(NIMI).then(async c => {
    const tallessa = await c.match(e.request, { ignoreSearch: true });
    const verkosta = fetch(e.request, { cache: 'no-cache' }).then(r => { if (r.ok) c.put(e.request, r.clone()); return r; });
    if (!tallessa) return verkosta;
    // hidas tai katkennut yhteys: 4 sekunnin jälkeen näytetään tallessa oleva versio
    return Promise.race([verkosta.catch(() => tallessa), new Promise(ok => setTimeout(() => ok(tallessa), 4000))]);
  }));
});
