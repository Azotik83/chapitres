// ═══════════════════════════════════════════════════════════════
// sync.js — Supabase : le compte, le delta, l'outbox, les photos.
//
// Rien ici n'est sur le chemin critique de la saisie. Si le réseau,
// la configuration ou le compte manquent, l'app tourne entière sur le
// miroir local et rattrape plus tard.
// ═══════════════════════════════════════════════════════════════

import { createClient } from "../vendor/supabase.js";
import { DEFAULT_CONFIG } from "./config.js";
import * as store from "./store.js";

const CONFIG_KEY = "chapitres.supabase";
const PAGE = 1000;

export const status = {
  configured: false,
  session: null,
  online: navigator.onLine,
  syncing: false,
  lastSync: null,
  error: null,
};

const listeners = new Set();
export function onStatus(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function emit() { for (const fn of listeners) fn(status); }

/* ── Configuration ────────────────────────────────────────────── */

export function getConfig() {
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    if (raw) {
      const o = JSON.parse(raw);
      if (o && o.url && o.key) return o;
    }
  } catch { /* stockage bloqué : on retombe sur les valeurs du dépôt */ }
  if (DEFAULT_CONFIG.url && DEFAULT_CONFIG.key) return { ...DEFAULT_CONFIG };
  return null;
}

export function setConfig(url, key) {
  const clean = { url: String(url || "").trim().replace(/\/+$/, ""), key: String(key || "").trim() };
  if (!clean.url || !clean.key) throw new Error("Il faut l'URL du projet et la clé anon.");
  if (!/^https:\/\/.+/.test(clean.url)) throw new Error("L'URL doit commencer par https://");
  try { localStorage.setItem(CONFIG_KEY, JSON.stringify(clean)); } catch { /* ignoré */ }
  sb = null;
  return clean;
}

export function clearConfig() {
  try { localStorage.removeItem(CONFIG_KEY); } catch { /* ignoré */ }
  sb = null;
}

/* ── Le client ────────────────────────────────────────────────── */

let sb = null;

export function client() {
  if (sb) return sb;
  const cfg = getConfig();
  if (!cfg) return null;
  sb = createClient(cfg.url, cfg.key, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      // Flux implicite : le lien du courriel marche même ouvert sur un
      // autre appareil que celui qui l'a demandé.
      flowType: "implicit",
      storageKey: "chapitres.auth",
    },
    realtime: { params: { eventsPerSecond: 2 } },
  });
  return sb;
}

const redirectTo = () => location.origin + location.pathname;

export async function signIn(email) {
  const c = client();
  if (!c) throw new Error("Configure d'abord ton projet Supabase.");
  const { error } = await c.auth.signInWithOtp({
    email: String(email).trim(),
    options: { emailRedirectTo: redirectTo() },
  });
  if (error) throw error;
}

// Se connecter avec le code reçu par courriel.
//
// C'est le chemin le plus court sur un téléphone : rien à ouvrir, rien
// à copier, on tape le code dans l'app — donc la session atterrit dans
// l'app, y compris quand elle est installée sur l'écran d'accueil.
export async function signInWithCode(email, code) {
  const c = client();
  if (!c) throw new Error("Aucune base n'est branchée sur cet appareil.");
  const token = String(code).replace(/\s+/g, "");
  if (!token) throw new Error("Tape le code reçu par courriel.");
  const { error } = await c.auth.verifyOtp({
    email: String(email).trim(),
    token,
    type: "email",
  });
  if (error) throw error;
}

// Se connecter en collant le lien reçu par courriel.
//
// C'est la seule façon de connecter une app installée sur l'écran
// d'accueil d'un iPhone : le lien s'ouvre forcément dans Safari, et une
// app installée a un stockage séparé de Safari. La session atterrirait
// donc à côté, et l'app resterait déconnectée indéfiniment.
export async function signInWithLink(raw) {
  const c = client();
  if (!c) throw new Error("Aucune base n'est branchée sur cet appareil.");

  let u;
  try { u = new URL(String(raw).trim()); }
  catch { throw new Error("Colle l'adresse complète du lien, en entier."); }

  // Forme 1 — l'adresse d'arrivée, qui porte déjà les jetons.
  const hash = new URLSearchParams(u.hash.replace(/^#/, ""));
  const at = hash.get("access_token");
  const rt = hash.get("refresh_token");
  if (at && rt) {
    const { error } = await c.auth.setSession({ access_token: at, refresh_token: rt });
    if (error) throw error;
    return;
  }

  // Forme 2 — le lien du courriel, qui porte un jeton à faire vérifier.
  const token = u.searchParams.get("token") || u.searchParams.get("token_hash");
  if (!token) throw new Error("Ce lien ne contient pas de jeton de connexion.");

  const declared = u.searchParams.get("type");
  const types = [];
  if (declared) types.push(declared);
  for (const t of ["magiclink", "email", "signup", "recovery", "invite"]) {
    if (!types.includes(t)) types.push(t);
  }

  let last = null;
  for (const type of types) {
    const { error } = await c.auth.verifyOtp({ token_hash: token, type });
    if (!error) return;
    last = error;
  }
  throw last || new Error("Lien refusé : il a déjà servi, ou il a expiré.");
}

export async function signOut() {
  const c = client();
  if (c) await c.auth.signOut();
  status.session = null;
  emit();
}

/* ── Démarrage ────────────────────────────────────────────────── */

let channel = null;
let authSub = null;
let wired = false;   // start() est rappelé depuis les réglages

export async function start() {
  status.configured = !!getConfig();
  emit();
  const c = client();
  if (!c) return;

  if (!wired) {
    wired = true;
    addEventListener("online", () => { status.online = true; emit(); sync(); });
    addEventListener("offline", () => { status.online = false; emit(); });
    addEventListener("visibilitychange", () => { if (!document.hidden) sync(); });
    store.setPushHook(() => sync());
  }

  const { data } = await c.auth.getSession();
  await onSession(data ? data.session : null);

  if (authSub) { try { authSub.unsubscribe(); } catch { /* ignoré */ } }
  const res = c.auth.onAuthStateChange((_evt, session) => { onSession(session); });
  authSub = res && res.data ? res.data.subscription : null;
}

async function onSession(session) {
  const changed = (status.session && status.session.user.id) !== (session && session.user.id);
  status.session = session || null;
  emit();
  if (!session) { unsubscribeLive(); return; }
  store.state.userId = session.user.id;
  await store.adoptOrphans(session.user.id);
  if (changed) subscribeLive(session.user.id);
  sync();
}

function subscribeLive(userId) {
  const c = client();
  if (!c) return;
  unsubscribeLive();
  try {
    channel = c.channel("chapitres")
      .on("postgres_changes",
        { event: "*", schema: "public", table: "entries", filter: `user_id=eq.${userId}` },
        () => sync())
      .on("postgres_changes",
        { event: "*", schema: "public", table: "chapters", filter: `user_id=eq.${userId}` },
        () => sync())
      .subscribe();
  } catch { /* le temps réel est un confort, pas une dépendance */ }
}

function unsubscribeLive() {
  if (!channel) return;
  try { client()?.removeChannel(channel); } catch { /* ignoré */ }
  channel = null;
}

/* ── La boucle de synchro, une seule à la fois ────────────────── */

let running = false;
let queued = false;

export async function sync() {
  if (!status.session || !status.online) return;
  if (running) { queued = true; return; }
  running = true;
  status.syncing = true;
  status.error = null;
  emit();
  try {
    // On TÉLÉCHARGE avant d'envoyer. Sur un appareil qui vient de se
    // connecter, l'inverse ferait partir son chapitre local sans qu'il
    // sache qu'un chapitre est déjà ouvert ailleurs — et l'envoi
    // échouerait, en bloquant tout le reste derrière lui.
    await pullTable("chapters");
    await pullTable("entries");
    await store.reconcileOpenChapters();

    // Les chapitres d'abord à l'envoi : une ligne référence son chapitre.
    await pushTable("chapters");
    await pushTable("entries");
    await pushPhotos();
    await fetchMissingPhotos();
    status.lastSync = Date.now();
  } catch (e) {
    status.error = e && e.message ? e.message : String(e);
  } finally {
    running = false;
    status.syncing = false;
    emit();
    if (queued) { queued = false; sync(); }
  }
}

const OUT = {
  entries: ["id", "user_id", "chapter_id", "day", "created_at", "text", "amount", "kind", "done", "deleted_at"],
  chapters: ["id", "user_id", "n", "name", "photo_path", "line", "start_date", "end_date", "net", "deleted_at"],
};

async function pushTable(table) {
  const rows = store.dirtyRows(table);
  if (!rows.length) return;
  const uid = status.session.user.id;
  // updated_at n'est jamais envoyé : c'est la base qui l'écrit, pour que
  // le delta ne dépende pas de l'horloge du téléphone.
  const payload = rows.map((r) => {
    const o = {};
    for (const k of OUT[table]) o[k] = r[k] === undefined ? null : r[k];
    o.user_id = uid;
    return o;
  });
  for (let i = 0; i < payload.length; i += 500) {
    const slice = payload.slice(i, i + 500);
    const { error } = await client().from(table).upsert(slice, { onConflict: "id" });
    if (error) throw error;
    await store.markClean(table, rows.slice(i, i + 500));
  }
}

async function pullTable(table) {
  const key = "lastPull." + table;
  let since = (await store.kvGet(key)) || "1970-01-01T00:00:00Z";
  for (;;) {
    const { data, error } = await client()
      .from(table)
      .select("*")
      .gt("updated_at", since)
      .order("updated_at", { ascending: true })
      .limit(PAGE);
    if (error) throw error;
    if (!data || !data.length) break;
    await store.applyRemote(table, data);
    since = data[data.length - 1].updated_at;
    await store.kvSet(key, since);
    if (data.length < PAGE) break;
  }
}

/* ── Les photos ───────────────────────────────────────────────── */

async function pushPhotos() {
  const pending = await store.dirtyPhotos();
  for (const p of pending) {
    const { error } = await client().storage
      .from("photos")
      .upload(p.path, p.blob, { contentType: "image/jpeg", upsert: true });
    if (error && error.statusCode !== "409") throw error;
    await store.markPhotoClean(p.path);
  }
}

async function fetchMissingPhotos() {
  for (const c of store.liveChapters()) {
    if (!c.photo_path) continue;
    if (await store.getPhoto(c.photo_path)) continue;
    try {
      const { data, error } = await client().storage.from("photos").download(c.photo_path);
      if (error || !data) continue;
      await store.putPhoto(c.photo_path, data);
      await store.markPhotoClean(c.photo_path);
    } catch { /* on réessaiera à la prochaine synchro */ }
  }
}

/* ── Une photo à l'écran, en ligne ou non ─────────────────────── */

const urls = new Map();

export async function photoURL(path) {
  if (!path) return null;
  if (urls.has(path)) return urls.get(path);
  const rec = await store.getPhoto(path);
  if (!rec) return null;
  const u = URL.createObjectURL(rec.blob);
  urls.set(path, u);
  return u;
}

export function forgetPhotoURL(path) {
  const u = urls.get(path);
  if (u) { URL.revokeObjectURL(u); urls.delete(path); }
}
