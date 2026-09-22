// ═══════════════════════════════════════════════════════════════
// core.js — le parseur (§13), les dates, les montants, les tags.
// Aucune dépendance, aucun effet de bord : tout est testable à part.
// ═══════════════════════════════════════════════════════════════

/* ── Le parseur, règle par règle ──────────────────────────────── */

export const AMOUNT_RE = /^([-−+])\s?([0-9]+(?:[.,][0-9]{1,2})?)\s*(.*)$/;
export const TAG_RE = /#[\wÀ-ÿ-]+/g;

const WHITE = ("faut penser noter rappeler relancer envoyer appeler finir rendre payer " +
  "acheter réserver contacter écrire lire monter ranger trier commander imprimer signer " +
  "valider vérifier demander préparer filmer exporter sauvegarder chercher trouver " +
  "terminer boucler caler poser passer prendre faire dire voir aller mettre oublier répondre"
).split(" ");

const BLACK = ("hier premier dernier papier cahier atelier quartier chantier calendrier " +
  "livre titre chiffre lettre ordre autre centre mètre théâtre fenêtre maître père mère " +
  "frère verre pierre terre guerre heure mer fer hiver air soir miroir couloir tiroir " +
  "comptoir avenir plaisir désir souvenir"
).split(" ");

const WHITELIST = new Set(WHITE);
const BLACKLIST = new Set(BLACK);

// On isole le premier mot : minuscules, sans la ponctuation qui l'entoure.
export function firstWord(s) {
  let tok = String(s).trim().split(/\s+/)[0] || "";
  try {
    tok = tok.replace(/^[^\p{L}]+/u, "").replace(/[^\p{L}]+$/u, "");
  } catch {
    tok = tok.replace(/^[^A-Za-zÀ-ÿ]+/, "").replace(/[^A-Za-zÀ-ÿ]+$/, "");
  }
  return tok.toLowerCase();
}

export function looksLikeTask(w) {
  if (!w) return false;
  if (WHITELIST.has(w)) return true;                  // liste blanche
  if (BLACKLIST.has(w)) return false;                 // liste noire
  return w.length > 3 && /(er|ir|re|oir)$/.test(w);   // les quatre terminaisons
}

// Une seule fonction, évaluée dans cet ordre. Le premier cas qui
// correspond gagne.
export function parse(raw) {
  const line = String(raw).trim();
  const m = AMOUNT_RE.exec(line);
  if (m) {                                            // 1. un montant ?
    const sign = m[1] === "+" ? 1 : -1;
    const v = sign * parseFloat(m[2].replace(",", "."));
    return { text: m[3].trim(), amount: Math.round(v * 100) / 100, kind: "m" };
  }
  if (looksLikeTask(firstWord(line)))                 // 2. sinon, une tâche ?
    return { text: line, amount: 0, kind: "t" };
  return { text: line, amount: 0, kind: "n" };        // 3. sinon, une note.
}

export function tagsOf(text) {
  TAG_RE.lastIndex = 0;
  const out = [];
  let m;
  while ((m = TAG_RE.exec(String(text))) !== null) {
    const t = m[0].slice(1).toLowerCase();
    if (t && out.indexOf(t) === -1) out.push(t);
  }
  return out;
}

/* ── Les dates ────────────────────────────────────────────────── */

const JOURS = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];
const MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet",
  "août", "septembre", "octobre", "novembre", "décembre"];

const p2 = (n) => (n < 10 ? "0" + n : "" + n);

export const ymd = (d) => d.getFullYear() + "-" + p2(d.getMonth() + 1) + "-" + p2(d.getDate());
export const today = () => ymd(new Date());

export function parseYmd(key) {
  const p = String(key).split("-");
  return new Date(+p[0], +p[1] - 1, +p[2]);
}

export function yesterday() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return ymd(d);
}

export function dayLabel(key) {
  if (key === today()) return "aujourd'hui";
  if (key === yesterday()) return "hier";
  const d = parseYmd(key);
  const s = JOURS[d.getDay()] + " " + d.getDate() + " " + MOIS[d.getMonth()];
  return d.getFullYear() === new Date().getFullYear() ? s : s + " " + d.getFullYear();
}

// « 15 août » — pour les dates de début et de fin d'un chapitre.
export function shortDate(key) {
  if (!key) return "";
  const d = parseYmd(key);
  return d.getDate() + " " + MOIS[d.getMonth()];
}

// Durée d'un chapitre, bornes comprises : un chapitre ouvert et fermé
// le même jour dure 1 jour, pas 0.
export function daysBetween(startKey, endKey) {
  const a = parseYmd(startKey);
  const b = endKey ? parseYmd(endKey) : new Date();
  const ms = new Date(b.getFullYear(), b.getMonth(), b.getDate()) -
             new Date(a.getFullYear(), a.getMonth(), a.getDate());
  return Math.max(1, Math.round(ms / 86400000) + 1);
}

/* ── Les montants ─────────────────────────────────────────────── */

let NF0 = null, NF2 = null;
try {
  NF0 = new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  NF2 = new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
} catch { /* formats de repli plus bas */ }

const isWhole = (x) => Math.abs(x - Math.round(x)) < 0.005;

// « +900 », « −38,40 » — le signe est toujours écrit.
export function fmtAmount(a, { decimals = "auto" } = {}) {
  const abs = Math.abs(a);
  const whole = decimals === "auto" ? isWhole(abs) : decimals === 0;
  let body;
  if (whole) body = NF0 ? NF0.format(Math.round(abs)) : String(Math.round(abs));
  else body = NF2 ? NF2.format(abs) : abs.toFixed(2).replace(".", ",");
  return (a < 0 ? "−" : "+") + body;
}

export const fmtEuro = (a) => fmtAmount(a, { decimals: 2 }) + " €";

// Forme que le parseur relit sans broncher — pour remettre une ligne
// d'argent dans la barre de saisie quand on la modifie.
export function reeditable(e) {
  if (e.kind !== "m") return e.text;
  const abs = Math.abs(e.amount);
  const n = isWhole(abs) ? String(Math.round(abs)) : abs.toFixed(2).replace(".", ",");
  return (e.amount < 0 ? "-" : "+") + n + (e.text ? " " + e.text : "");
}

/* ── Identifiants ─────────────────────────────────────────────── */

export function uuid() {
  if (globalThis.crypto && crypto.randomUUID) return crypto.randomUUID();
  const b = new Uint8Array(16);
  (globalThis.crypto || { getRandomValues: (a) => a.forEach((_, i) => (a[i] = Math.random() * 256 | 0)) })
    .getRandomValues(b);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/* ── Les deux noms proposés à la clôture (§8) ─────────────────── */
// « L'app propose deux noms tirés de tes propres lignes ; tu prends ou
// tu écris le tien. » On cherche des phrases, pas des tâches : une note
// de longueur moyenne fait un meilleur titre qu'un rappel.

export function suggestNames(entries, chapterNumber) {
  const clean = (s) => String(s).replace(TAG_RE, "").replace(/\s+/g, " ").trim();
  const cap = (s) => (s ? s[0].toLocaleUpperCase("fr") + s.slice(1) : s);

  const notes = entries
    .filter((e) => e.kind === "n")
    .map((e) => clean(e.text))
    .filter((s) => s.length >= 8 && s.length <= 48);

  // Les plus proches de 28 caractères d'abord : assez pour dire quelque
  // chose, assez court pour tenir sous une vignette.
  notes.sort((a, b) => Math.abs(a.length - 28) - Math.abs(b.length - 28));

  const out = [];
  for (const n of notes) {
    const c = cap(n);
    if (!out.includes(c)) out.push(c);
    if (out.length === 2) break;
  }

  if (out.length < 2) {
    const counts = new Map();
    for (const e of entries)
      for (const t of tagsOf(e.text)) counts.set(t, (counts.get(t) || 0) + 1);
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
    if (top) {
      const c = cap(top[0]);
      if (!out.includes(c)) out.push(c);
    }
  }
  while (out.length < 2) {
    const c = "Chapitre " + (chapterNumber + out.length * 0);
    out.push(out.includes(c) ? c + " bis" : c);
  }
  return out.slice(0, 2);
}
