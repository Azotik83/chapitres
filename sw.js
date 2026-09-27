// ═══════════════════════════════════════════════════════════════
// sw.js — le service worker.
//
// Il met la coquille de l'app en cache pour qu'elle s'ouvre sans
// réseau. Il ne touche JAMAIS aux appels Supabase : les données ne
// passent pas par lui, seule la page passe par lui.
//
// Quand tu modifies l'app, change VERSION ci-dessous : c'est ce qui
// dit aux téléphones déjà installés d'aller chercher la nouvelle.
// ═══════════════════════════════════════════════════════════════

const VERSION = "raptat-v12";

const SHELL = [
  "./",
  "./index.html",
  "./app.css",
  "./manifest.webmanifest",
  "./js/main.js",
  "./js/core.js",
  "./js/store.js",
  "./js/sync.js",
  "./js/ui.js",
  "./js/today.js",
  "./js/chapters.js",
  "./js/money.js",
  "./js/config.js",
  "./js/push.js",
  "./vendor/supabase.js",
  "./icons/favicon.svg",
  "./icons/mark.svg",
  "./icons/wordmark.svg",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png",
  "./icons/apple-touch-icon.png",
  "./fonts/ibm-plex-sans-400-latin.woff2",
  "./fonts/ibm-plex-sans-400-latin-ext.woff2",
  "./fonts/ibm-plex-sans-500-latin.woff2",
  "./fonts/ibm-plex-sans-500-latin-ext.woff2",
  "./fonts/ibm-plex-sans-600-latin.woff2",
  "./fonts/ibm-plex-sans-600-latin-ext.woff2",
  "./fonts/ibm-plex-mono-400-latin.woff2",
  "./fonts/ibm-plex-mono-400-latin-ext.woff2",
  "./fonts/ibm-plex-mono-500-latin.woff2",
  "./fonts/ibm-plex-mono-500-latin-ext.woff2",
];

self.addEventListener("install", (ev) => {
  ev.waitUntil((async () => {
    const cache = await caches.open(VERSION);
    // addAll échoue en bloc si un seul fichier manque : on y va un par un
    // pour qu'une icône absente n'empêche pas l'installation.
    await Promise.all(SHELL.map((u) => cache.add(u).catch(() => {})));
    self.skipWaiting();
  })());
});

self.addEventListener("activate", (ev) => {
  ev.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (ev) => {
  const req = ev.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  // Tout ce qui n'est pas la coquille (donc Supabase) passe droit au
  // réseau, sans cache et sans interception.
  if (url.origin !== location.origin) return;

  // Une navigation : le réseau d'abord, pour que la mise à jour arrive ;
  // le cache si on est hors ligne.
  if (req.mode === "navigate") {
    ev.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        const cache = await caches.open(VERSION);
        cache.put("./index.html", fresh.clone());
        return fresh;
      } catch {
        const cached = await caches.match("./index.html", { ignoreSearch: true });
        return cached || new Response("Hors ligne.", { status: 503, headers: { "content-type": "text/plain; charset=utf-8" } });
      }
    })());
    return;
  }

  // Le reste : le cache d'abord, et on rafraîchit derrière.
  ev.respondWith((async () => {
    const cached = await caches.match(req);
    const network = fetch(req).then((res) => {
      if (res && res.ok) caches.open(VERSION).then((c) => c.put(req, res.clone()));
      return res;
    }).catch(() => null);
    return cached || (await network) || new Response("", { status: 504 });
  })());
});


/* ── Les notifications ────────────────────────────────────────── */
// Une seule sorte de notification existe : la question des 66 jours.
// Pas de rappel quotidien, pas de relance — c'est ce que la règle 10 du
// plan interdit, et c'est la première chose qu'on finit par éteindre.

self.addEventListener("push", (ev) => {
  let d = {};
  try { d = ev.data ? ev.data.json() : {}; }
  catch { d = { corps: ev.data ? ev.data.text() : "" }; }

  ev.waitUntil(self.registration.showNotification(d.titre || "RAPTAT", {
    body: d.corps || "",
    icon: "./icons/icon-192.png",
    badge: "./icons/icon-192.png",
    lang: "fr",
    // Un seul fil : une question qui remplace la précédente plutôt que
    // de s'empiler sur l'écran de verrouillage.
    tag: "raptat-habitude",
    renotify: false,
    data: { url: d.url || "./" },
  }));
});

self.addEventListener("notificationclick", (ev) => {
  ev.notification.close();
  const url = (ev.notification.data && ev.notification.data.url) || "./";
  ev.waitUntil((async () => {
    // Si l'app est déjà ouverte quelque part, on y revient au lieu d'en
    // ouvrir une deuxième.
    const fenetres = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const f of fenetres) {
      if ("focus" in f) return f.focus();
    }
    if (self.clients.openWindow) return self.clients.openWindow(url);
  })());
});
