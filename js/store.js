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
const DB_VERSION = 1;

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
  userId: null,
};

const listeners = new Set();
export function onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export function emit() { for (const fn of listeners) fn(); }

let pushHook = null;
export function setPushHook(fn) { pushHook = fn; }
function wake() { if (pushHook) pushHook(); }

export async function loadAll() {
  const [entries, chapters] = await Promise.all([all("entries"), all("chapters")]);
  state.entries = new Map(entries.map((e) => [e.id, e]));
  state.chapters = new Map(chapters.map((c) => [c.id, c]));
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
  [...(store === "entries" ? state.entries : state.chapters).values()].filter((r) => r.dirty === 1);

export async function markClean(store, rows) {
  const t = tx([store], "readwrite");
  const os = t.objectStore(store);
  const mem = store === "entries" ? state.entries : state.chapters;
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
  const mem = store === "entries" ? state.entries : state.chapters;
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
  for (const m of [state.entries, state.chapters])
    for (const r of m.values()) if (!r.user_id) { r.user_id = userId; r.dirty = 1; fix.push(r); }
  if (!fix.length) return 0;
  const t = tx(["entries", "chapters"], "readwrite");
  for (const r of fix) t.objectStore(state.entries.has(r.id) ? "entries" : "chapters").put(r);
  await done(t);
  return fix.length;
}

export async function wipeLocal() {
  const t = tx(["entries", "chapters", "photos", "kv"], "readwrite");
  for (const s of ["entries", "chapters", "photos", "kv"]) t.objectStore(s).clear();
  await done(t);
  state.entries.clear();
  state.chapters.clear();
  emit();
}
