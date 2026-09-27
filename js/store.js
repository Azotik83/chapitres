// ═══════════════════════════════════════════════════════════════
// store.js — le miroir local.
//
// L'app écrit d'abord ici et ne dépend jamais du réseau pour accepter
// une ligne. Toute mutation :
//   1. change l'état en mémoire (c'est lui que les vues peignent),
//   2. écrit dans IndexedDB avec dirty=1,
//   3. réveille la synchro, qui videra l'outbox quand elle pourra.
// ═══════════════════════════════════════════════════════════════

import { uuid, today, tagsOf, daysBetween } from "./core.js";

const DB_NAME = "chapitres";
const DB_VERSION = 2;

let idb = null;

export function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("entries")) {
        const s = db.createObjectStore("entries", { keyPath: "id" });
        s.createIndex("day", "day");
        s.createIndex("chapter_id", "chapter_id");
        s.createIndex("dirty", "dirty");
      }
      if (!db.objectStoreNames.contains("chapters")) {
        const s = db.createObjectStore("chapters", { keyPath: "id" });
        s.createIndex("n", "n");
        s.createIndex("dirty", "dirty");
      }
      // Les magasins portent le NOM DES TABLES : c'est ce qui rend la
      // synchro entierement generique, sans table speciale nulle part.
      if (!db.objectStoreNames.contains("habits")) {
        const s = db.createObjectStore("habits", { keyPath: "id" });
        s.createIndex("dirty", "dirty");
      }
      if (!db.objectStoreNames.contains("habit_ticks")) {
        const s = db.createObjectStore("habit_ticks", { keyPath: "id" });
        s.createIndex("habit_id", "habit_id");
        s.createIndex("dirty", "dirty");
      }
      if (!db.objectStoreNames.contains("photos")) db.createObjectStore("photos", { keyPath: "path" });
      if (!db.objectStoreNames.contains("kv")) db.createObjectStore("kv", { keyPath: "k" });
    };
    req.onsuccess = () => { idb = req.result; resolve(idb); };
    req.onerror = () => reject(req.error);
  });
}

function tx(stores, mode) {
  return idb.transaction(stores, mode);
}
function done(t) {
  return new Promise((res, rej) => {
    t.oncomplete = () => res();
    t.onerror = () => rej(t.error);
    t.onabort = () => rej(t.error);
  });
}
function all(store) {
  return new Promise((res, rej) => {
    const r = tx([store], "readonly").objectStore(store).getAll();
    r.onsuccess = () => res(r.result || []);
    r.onerror = () => rej(r.error);
  });
}

export async function kvGet(k) {
  return new Promise((res) => {
    const r = tx(["kv"], "readonly").objectStore("kv").get(k);
    r.onsuccess = () => res(r.result ? r.result.v : null);
    r.onerror = () => res(null);
  });
}
export async function kvSet(k, v) {
  const t = tx(["kv"], "readwrite");
  t.objectStore("kv").put({ k, v });
  return done(t);
}

/* ── L'état en mémoire ────────────────────────────────────────── */

export const state = {
  entries: new Map(),   // id -> ligne
  chapters: new Map(),  // id -> chapitre
  habits: new Map(),    // id -> habitude
  habit_ticks: new Map(),  // id -> cochage
  userId: null,
};

// Une seule table de correspondance : plus aucun endroit du code n'a
// besoin de savoir quelles tables existent.
export const SYNCED = ["chapters", "entries", "habits", "habit_ticks"];
const memOf = (name) => state[name];

const listeners = new Set();
export function onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export function emit() { for (const fn of listeners) fn(); }

let pushHook = null;
export function setPushHook(fn) { pushHook = fn; }
function wake() { if (pushHook) pushHook(); }

export async function loadAll() {
  const lots = await Promise.all(SYNCED.map((n) => all(n)));
  SYNCED.forEach((name, i) => {
    state[name] = new Map(lots[i].map((r) => [r.id, r]));
  });
}

function putLocal(store, row) {
  const t = tx([store], "readwrite");
  t.objectStore(store).put(row);
  return done(t);
}

/* ── Sélecteurs ───────────────────────────────────────────────── */

export const liveEntries = () =>
  [...state.entries.values()].filter((e) => !e.deleted_at);

export const liveChapters = () =>
  [...state.chapters.values()].filter((c) => !c.deleted_at).sort((a, b) => a.n - b.n);

export function currentChapter() {
  const open = liveChapters().filter((c) => !c.end_date);
  return open.length ? open[open.length - 1] : null;
}

export const sealedChapters = () => liveChapters().filter((c) => c.end_date);

export function chapterEntries(chapterId) {
  return liveEntries()
    .filter((e) => e.chapter_id === chapterId)
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
}

// Le fil de l'écran Aujourd'hui : groupé par jour, du plus récent au
// plus ancien, et dans un jour du plus récent au plus ancien aussi.
export function entriesByDay(limitDays = 90) {
  const days = new Map();
  for (const e of liveEntries()) {
    if (!days.has(e.day)) days.set(e.day, []);
    days.get(e.day).push(e);
  }
  const keys = [...days.keys()].sort().reverse().slice(0, limitDays);
  return keys.map((day) => ({
    day,
    items: days.get(day).sort((a, b) => (a.created_at < b.created_at ? 1 : -1)),
  }));
}

// Les jours du fil = ceux qui portent une ligne ecrite, PLUS ceux ou tu
// n'as fait que cocher une habitude. Sans cette union, une journee sans
// un mot ecrit mais avec une habitude tenue disparaissait du fil : le
// cochage devenait invisible dans l'historique.
export function feedDays(limitDays = 90) {
  const parJour = new Map();
  for (const e of liveEntries()) {
    if (!parJour.has(e.day)) parJour.set(e.day, []);
    parJour.get(e.day).push(e);
  }
  for (const t of [...state.habit_ticks.values()]) {
    if (t.deleted_at) continue;
    const h = state.habits.get(t.habit_id);
    if (!h || h.deleted_at) continue;
    if (!parJour.has(t.day)) parJour.set(t.day, []);
  }
  return [...parJour.keys()].sort().reverse().slice(0, limitDays).map((day) => ({
    day,
    items: (parJour.get(day) || []).sort((a, b) => (a.created_at < b.created_at ? 1 : -1)),
  }));
}

export function chapterNet(chapter) {
  // Un chapitre scellé porte son net figé au moment de la clôture ;
  // le chapitre en cours se recalcule à chaque affichage — un total
  // stocké est un total qui finit par mentir.
  if (chapter.end_date) return Number(chapter.net) || 0;
  return chapterEntries(chapter.id).reduce((s, e) => s + (Number(e.amount) || 0), 0);
}

export function chapterCounts(chapterId) {
  const c = { m: 0, t: 0, n: 0 };
  for (const e of chapterEntries(chapterId)) c[e.kind] = (c[e.kind] || 0) + 1;
  return c;
}

// Totaux par projet, tous chapitres confondus (§5).
export function tagTotals() {
  const map = new Map();
  for (const e of liveEntries()) {
    for (const t of tagsOf(e.text)) {
      if (!map.has(t)) map.set(t, { tag: t, net: 0, in: 0, out: 0, count: 0 });
      const r = map.get(t);
      r.count++;
      const a = Number(e.amount) || 0;
      r.net += a;
      if (a > 0) r.in += a;
      if (a < 0) r.out += a;
    }
  }
  return [...map.values()].sort((a, b) => Math.abs(b.net) - Math.abs(a.net) || b.count - a.count);
}

export function entriesWithTag(tag) {
  const t = String(tag).toLowerCase();
  return liveEntries()
    .filter((e) => tagsOf(e.text).includes(t))
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
}

/* ── Mutations ────────────────────────────────────────────────── */

const nowIso = () => new Date().toISOString();

async function saveEntry(e) {
  e.dirty = 1;
  e.updated_at = nowIso();
  state.entries.set(e.id, e);
  await putLocal("entries", e);
  emit();
  wake();
  return e;
}

async function saveChapter(c) {
  c.dirty = 1;
  c.updated_at = nowIso();
  state.chapters.set(c.id, c);
  await putLocal("chapters", c);
  emit();
  wake();
  return c;
}

// Le premier chapitre s'ouvre tout seul, vide et sans nom.
export async function ensureCurrentChapter() {
  let c = currentChapter();
  if (c) return c;
  const n = liveChapters().reduce((m, x) => Math.max(m, x.n), 0) + 1;
  c = {
    id: uuid(), user_id: state.userId, n,
    name: null, photo_path: null, line: null,
    start_date: today(), end_date: null, net: 0,
    updated_at: nowIso(), deleted_at: null,
  };
  return saveChapter(c);
}

export async function addEntry(parsed, { day = today(), chapterId = null } = {}) {
  const chapter = chapterId ? state.chapters.get(chapterId) : await ensureCurrentChapter();
  return saveEntry({
    id: uuid(),
    user_id: state.userId,
    chapter_id: chapter ? chapter.id : null,
    day,
    created_at: nowIso(),
    text: parsed.text,
    amount: parsed.amount,
    kind: parsed.kind,
    done: false,
    updated_at: nowIso(),
    deleted_at: null,
  });
}

export async function patchEntry(id, patch) {
  const e = state.entries.get(id);
  if (!e) return null;
  return saveEntry({ ...e, ...patch });
}

export async function deleteEntry(id) {
  const e = state.entries.get(id);
  if (!e) return null;
  return saveEntry({ ...e, deleted_at: nowIso() });
}

export async function restoreEntry(id) {
  const e = state.entries.get(id);
  if (!e) return null;
  return saveEntry({ ...e, deleted_at: null });
}

// Fermer un chapitre : on le scelle, et le suivant s'ouvre tout seul.
export async function closeChapter(id, { name, line, photoPath }) {
  const c = state.chapters.get(id);
  if (!c || c.end_date) return null;
  const end = today();
  const net = chapterEntries(id).reduce((s, e) => s + (Number(e.amount) || 0), 0);
  await saveChapter({
    ...c,
    name: name || null,
    line: line || null,
    photo_path: photoPath || c.photo_path || null,
    end_date: end,
    net: Math.round(net * 100) / 100,
  });
  const next = {
    id: uuid(), user_id: state.userId, n: c.n + 1,
    name: null, photo_path: null, line: null,
    start_date: end, end_date: null, net: 0,
    updated_at: nowIso(), deleted_at: null,
  };
  await saveChapter(next);
  return next;
}

export const chapterDays = (c) => daysBetween(c.start_date, c.end_date);

// Deux chapitres ouverts ne peuvent pas coexister.
//
// Le cas qui arrive pour de vrai : tu installes l'app sur un deuxième
// appareil, tu écris une ligne avant de te connecter. Cet appareil ne
// sait rien du chapitre déjà ouvert ailleurs, il en crée donc un à lui.
// À la connexion, on se retrouve avec deux chapitres en cours.
//
// On garde le plus ancien — et à égalité celui dont l'identifiant est le
// plus petit, pour que tous les appareils prennent la MÊME décision sans
// se parler — et on replie l'autre dedans : ses lignes changent de
// chapitre, lui passe en supprimé. Rien n'est perdu.
export async function reconcileOpenChapters() {
  const open = liveChapters().filter((c) => !c.end_date);
  if (open.length < 2) return 0;

  open.sort((a, b) =>
    a.start_date < b.start_date ? -1 :
    a.start_date > b.start_date ? 1 :
    a.id < b.id ? -1 : 1);

  const keep = open[0];
  let moved = 0;
  for (const dup of open.slice(1)) {
    for (const e of liveEntries()) {
      if (e.chapter_id !== dup.id) continue;
      await saveEntry({ ...e, chapter_id: keep.id });
      moved++;
    }
    await saveChapter({ ...dup, deleted_at: nowIso() });
  }
  return moved;
}

/* ── Les habitudes ────────────────────────────────────────────── */
//
// Une habitude est une ligne qui revient chaque jour sans qu'on ait rien
// a ecrire. Elle ne s'affiche QUE sur aujourd'hui : si elle apparaissait
// aussi sur les jours passes, scroller en arriere montrerait un mur de
// cases vides — exactement la culpabilite que le plan interdit. Les
// jours passes ne montrent donc que ce qui a ete reellement coche.

export const liveHabits = () =>
  [...state.habits.values()]
    .filter((h) => !h.deleted_at)
    .sort((a, b) => (a.created_at < b.created_at ? -1 : 1));

// Celles qui comptent aujourd'hui : ni ancrees, ni arretees.
export const activeHabits = () =>
  liveHabits().filter((h) => !h.anchored_at && !h.stopped_at);

// Depuis combien de temps tu tiens l'habitude. Ce n'est PAS une serie :
// sauter un jour ne remet rien a zero, rien ne se « casse ».
export const habitDays = (h) => daysBetween(h.start_date, h.anchored_at || h.stopped_at || null);

const liveTicks = () => [...state.habit_ticks.values()].filter((t) => !t.deleted_at);

// On deduplique a la lecture : deux appareils qui cochent le meme jour
// creent deux lignes, et c'est tres bien — mieux qu'une contrainte
// unique qui bloquerait la synchro.
export function isTicked(habitId, day) {
  return liveTicks().some((t) => t.habit_id === habitId && t.day === day);
}

export function tickCount(habitId) {
  const vus = new Set();
  for (const t of liveTicks()) if (t.habit_id === habitId) vus.add(t.day);
  return vus.size;
}

// Les cochages d'un jour donne, pour les afficher dans le passe.
export function ticksOfDay(day) {
  const parHabitude = new Map();
  for (const t of liveTicks()) {
    if (t.day !== day) continue;
    const h = state.habits.get(t.habit_id);
    if (h && !h.deleted_at) parHabitude.set(t.habit_id, h);
  }
  return [...parHabitude.values()];
}

export async function addHabit(text, { startDate = today(), cue = null } = {}) {
  const h = {
    id: uuid(), user_id: state.userId,
    text: String(text).trim(),
    // Le declencheur : un CONTEXTE, pas une heure. « apres le cafe ».
    cue: cue ? String(cue).trim() : null,
    start_date: startDate,
    anchored_at: null, stopped_at: null,
    ask_after: 66, last_asked_on: null,
    created_at: nowIso(), updated_at: nowIso(), deleted_at: null,
  };
  h.dirty = 1;
  state.habits.set(h.id, h);
  await putLocal("habits", h);
  emit(); wake();
  return h;
}

async function saveHabit(h) {
  h.dirty = 1;
  h.updated_at = nowIso();
  state.habits.set(h.id, h);
  await putLocal("habits", h);
  emit(); wake();
  return h;
}

export async function patchHabit(id, patch) {
  const h = state.habits.get(id);
  if (!h) return null;
  return saveHabit({ ...h, ...patch });
}

export const anchorHabit = (id) => patchHabit(id, { anchored_at: today() });
export const stopHabit   = (id) => patchHabit(id, { stopped_at: today() });
export const deleteHabit = (id) => patchHabit(id, { deleted_at: nowIso() });

// « Pas encore » : on redemande dans une semaine, pas avant.
export const snoozeHabit = (id) => patchHabit(id, { last_asked_on: today() });

export async function toggleTick(habitId, day = today()) {
  const existants = liveTicks().filter((t) => t.habit_id === habitId && t.day === day);
  if (existants.length) {
    // Decocher : on pose une pierre tombale sur TOUS les doublons.
    for (const t of existants) {
      const mort = { ...t, deleted_at: nowIso(), dirty: 1, updated_at: nowIso() };
      state.habit_ticks.set(mort.id, mort);
      await putLocal("habit_ticks", mort);
    }
    emit(); wake();
    return false;
  }
  const t = {
    id: uuid(), user_id: state.userId, habit_id: habitId, day,
    created_at: nowIso(), updated_at: nowIso(), deleted_at: null, dirty: 1,
  };
  state.habit_ticks.set(t.id, t);
  await putLocal("habit_ticks", t);
  emit(); wake();
  return true;
}

// Les habitudes qui ont atteint leur seuil et qu'il faut questionner.
// Une fois la question posee, on ne la repose qu'une semaine plus tard.
export function habitsToAsk() {
  const t = today();
  return activeHabits().filter((h) => {
    if (habitDays(h) < (h.ask_after || 66)) return false;
    if (!h.last_asked_on) return true;
    return daysBetween(h.last_asked_on, t) > 7;
  });
}

/* ── Photos ───────────────────────────────────────────────────── */

export async function putPhoto(path, blob) {
  const t = tx(["photos"], "readwrite");
  t.objectStore("photos").put({ path, blob, dirty: 1 });
  await done(t);
  wake();
}
export function getPhoto(path) {
  return new Promise((res) => {
    const r = tx(["photos"], "readonly").objectStore("photos").get(path);
    r.onsuccess = () => res(r.result || null);
    r.onerror = () => res(null);
  });
}
export async function markPhotoClean(path) {
  const rec = await getPhoto(path);
  if (!rec) return;
  rec.dirty = 0;
  const t = tx(["photos"], "readwrite");
  t.objectStore("photos").put(rec);
  return done(t);
}
export function dirtyPhotos() {
  return new Promise((res) => {
    const r = tx(["photos"], "readonly").objectStore("photos").getAll();
    r.onsuccess = () => res((r.result || []).filter((p) => p.dirty === 1));
    r.onerror = () => res([]);
  });
}

/* ── L'outbox ─────────────────────────────────────────────────── */

export const dirtyRows = (store) =>
  [...memOf(store).values()].filter((r) => r.dirty === 1);

export async function markClean(store, rows) {
  const t = tx([store], "readwrite");
  const os = t.objectStore(store);
  const mem = memOf(store);
  for (const row of rows) {
    const cur = mem.get(row.id);
    // Si la ligne a rebougé pendant l'envoi, elle reste sale.
    if (!cur || cur.updated_at !== row.updated_at) continue;
    cur.dirty = 0;
    os.put(cur);
  }
  await done(t);
}

// Ce que la base renvoie écrase le local — sauf si le local est encore
// sale, auquel cas c'est lui qui partira au prochain envoi.
export async function applyRemote(store, rows) {
  if (!rows.length) return 0;
  const mem = memOf(store);
  const t = tx([store], "readwrite");
  const os = t.objectStore(store);
  let n = 0;
  for (const row of rows) {
    const cur = mem.get(row.id);
    if (cur && cur.dirty === 1) continue;
    const clean = { ...row, dirty: 0 };
    mem.set(clean.id, clean);
    os.put(clean);
    n++;
  }
  await done(t);
  if (n) emit();
  return n;
}

// Au premier rattachement d'un compte, les lignes écrites hors ligne
// n'ont pas de user_id : on les adopte.
export async function adoptOrphans(userId) {
  const fix = [];
  for (const name of SYNCED)
    for (const r of memOf(name).values())
      if (!r.user_id) { r.user_id = userId; r.dirty = 1; fix.push([name, r]); }
  if (!fix.length) return 0;
  const t = tx(SYNCED, "readwrite");
  for (const [name, r] of fix) t.objectStore(name).put(r);
  await done(t);
  return fix.length;
}

export async function wipeLocal() {
  const noms = SYNCED.concat(["photos", "kv"]);
  const t = tx(noms, "readwrite");
  for (const n of noms) t.objectStore(n).clear();
  await done(t);
  for (const n of SYNCED) memOf(n).clear();
  emit();
}
