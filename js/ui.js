// ═══════════════════════════════════════════════════════════════
// ui.js — les primitives d'écran.
//
// Une ligne, l'appui long, la feuille d'action, le message qui
// propose d'annuler. Tout le reste s'appuie là-dessus, pour qu'il
// n'y ait bien qu'un seul geste à apprendre dans toute l'app.
// ═══════════════════════════════════════════════════════════════

import { TAG_RE, fmtAmount } from "./core.js";

export function el(tag, props = {}, kids = []) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === "class") n.className = v;
    else if (k === "text") n.textContent = v;
    else if (k === "dataset") Object.assign(n.dataset, v);
    else if (k.startsWith("on")) n.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === "disabled" || k === "hidden") n[k] = !!v;
    else n.setAttribute(k, v);
  }
  for (const kid of [].concat(kids)) {
    if (kid === null || kid === undefined || kid === false) continue;
    n.appendChild(typeof kid === "string" ? document.createTextNode(kid) : kid);
  }
  return n;
}

export function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); return node; }

// Les tags sont repérés à l'affichage, jamais retirés du texte stocké.
export function textWithTags(text) {
  const frag = document.createDocumentFragment();
  let last = 0, m;
  TAG_RE.lastIndex = 0;
  while ((m = TAG_RE.exec(text)) !== null) {
    if (m.index > last) frag.appendChild(document.createTextNode(text.slice(last, m.index)));
    frag.appendChild(el("span", { class: "tag", text: m[0] }));
    last = m.index + m[0].length;
  }
  if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
  return frag;
}

// Construit en DOM plutôt qu'en chaîne : el() n'expose plus aucun
// innerHTML, donc il n'existe aucun endroit par où du texte pourrait
// devenir du balisage.
const SVG_NS = "http://www.w3.org/2000/svg";
function checkMark() {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS(SVG_NS, "path");
  path.setAttribute("d", "M3.4 8.5 6.5 11.5 12.6 4.8");
  svg.appendChild(path);
  return svg;
}

// Une tâche a une case ; une note n'en a pas, et son texte s'aligne sur
// la même colonne que les autres.
export function entryRow(e, { interactive = true } = {}) {
  const row = el("div", {
    class: "row" + (e.kind === "t" ? " task" : "") + (e.kind === "t" && e.done ? " done" : ""),
    dataset: { id: e.id },
    tabindex: interactive ? "0" : null,
    role: e.kind === "t" && interactive ? "checkbox" : null,
    "aria-checked": e.kind === "t" && interactive ? (e.done ? "true" : "false") : null,
  });
  row.appendChild(el("div", { class: "txt" }, [textWithTags(e.text)]));
  if (e.kind === "m") {
    row.appendChild(el("span", {
      class: "amt " + (e.amount < 0 ? "out" : "in"),
      text: fmtAmount(e.amount),
    }));
  } else if (e.kind === "t") {
    row.appendChild(el("span", { class: "box" }, [checkMark()]));
  }
  return row;
}

/* ── Tap = cocher. Appui long (500 ms) = menu. Rien d'autre. ──── */

export function attachRowGestures(container, { onTap, onHold }) {
  let timer = null, row = null, x = 0, y = 0, fired = false;

  const cancel = () => {
    clearTimeout(timer);
    timer = null;
    if (row) row.classList.remove("pressing");
    row = null;
  };

  container.addEventListener("pointerdown", (ev) => {
    if (ev.button > 0) return;
    const r = ev.target.closest(".row");
    if (!r) return;
    cancel();
    fired = false;
    row = r; x = ev.clientX; y = ev.clientY;
    r.classList.add("pressing");
    timer = setTimeout(() => { fired = true; cancel(); onHold(r.dataset.id, r); }, 500);
  });
  container.addEventListener("pointermove", (ev) => {
    if (!timer) return;
    if (Math.abs(ev.clientX - x) > 10 || Math.abs(ev.clientY - y) > 10) cancel();
  });
  container.addEventListener("pointerup", cancel);
  container.addEventListener("pointercancel", cancel);
  container.addEventListener("scroll", cancel, { passive: true });

  container.addEventListener("click", (ev) => {
    if (fired) { fired = false; return; }
    const r = ev.target.closest(".row");
    if (r) onTap(r.dataset.id, r);
  });

  // L'équivalent de l'appui long à la souris et au clavier.
  container.addEventListener("contextmenu", (ev) => {
    const r = ev.target.closest(".row");
    if (!r) return;
    ev.preventDefault();
    cancel();
    fired = true;
    onHold(r.dataset.id, r);
  });
  container.addEventListener("keydown", (ev) => {
    const r = ev.target.closest && ev.target.closest(".row");
    if (!r) return;
    if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); onTap(r.dataset.id, r); }
  });
}

/* ── La feuille d'action ──────────────────────────────────────── */

let sheetEl = null, sheetReturn = null;

export function closeSheet() {
  if (!sheetEl) return;
  sheetEl.remove();
  sheetEl = null;
  if (sheetReturn && document.contains(sheetReturn)) sheetReturn.focus();
  sheetReturn = null;
}

export function actionSheet(head, items) {
  closeSheet();
  sheetReturn = document.activeElement;

  const sheet = el("div", {
    class: "sheet", role: "dialog", "aria-modal": "true", "aria-label": "Actions",
  });
  if (head) sheet.appendChild(el("div", { class: "sheet-head", text: head }));
  for (const it of items) {
    if (!it) continue;
    sheet.appendChild(el("button", {
      type: "button", class: it.tone || null, text: it.label,
      onclick: () => { closeSheet(); if (it.run) it.run(); },
    }));
  }
  sheetEl = el("div", { class: "scrim" }, [sheet]);
  sheetEl.addEventListener("pointerdown", (ev) => { if (ev.target === sheetEl) closeSheet(); });
  document.body.appendChild(sheetEl);
  const first = sheet.querySelector("button");
  if (first) first.focus();
}

/* ── Le message de confirmation, quatre secondes ──────────────── */
// Il dit ce que l'app a décidé — c'est comme ça que la règle s'apprend,
// sans tutoriel et sans écran d'aide.

let toastTimer = null, undoFn = null;

export function toast(message, undo) {
  const host = document.getElementById("toasthost");
  if (!host) return;
  clearTimeout(toastTimer);
  undoFn = undo || null;
  clear(host);

  const bar = el("div", { class: "toast-bar" });
  const node = el("div", { class: "toast", role: "status", "aria-live": "polite" }, [
    el("span", { class: "toast-msg", text: message }),
    undo ? el("button", {
      type: "button", class: "toast-undo", text: "Annuler",
      onclick: () => { const f = undoFn; hideToast(); if (f) f(); },
    }) : null,
    bar,
  ]);
  host.appendChild(node);
  toastTimer = setTimeout(hideToast, 4000);
}

export function hideToast() {
  clearTimeout(toastTimer);
  undoFn = null;
  const host = document.getElementById("toasthost");
  if (host) clear(host);
}

/* ── Une page poussée par-dessus (chapitre, projet) ───────────── */

const stack = [];

export function pushPage(node) {
  const host = document.getElementById("pages");
  host.appendChild(node);
  stack.push(node);
  host.hidden = false;
  node.scrollTop = 0;
  return node;
}

export function popPage() {
  const node = stack.pop();
  if (node) node.remove();
  const host = document.getElementById("pages");
  if (!stack.length) host.hidden = true;
}

export function popAllPages() { while (stack.length) popPage(); }
export const pageDepth = () => stack.length;

export function page({ title, back = "Chapitres", onBack, modal = false }, body) {
  const node = el("div", { class: "page" + (modal ? " modal" : "") }, [
    el("header", { class: "pagebar" }, [
      el("button", {
        type: "button", class: "backbtn",
        text: (modal ? "" : "‹ ") + back,
        onclick: () => { if (onBack) onBack(); else popPage(); },
      }),
      title ? el("span", { class: "pagetitle", text: title }) : null,
    ]),
    el("div", { class: "pagebody" }, [].concat(body)),
  ]);
  return node;
}

document.addEventListener("keydown", (ev) => {
  if (ev.key !== "Escape") return;
  if (sheetEl) { ev.preventDefault(); closeSheet(); return; }
  if (pageDepth()) { ev.preventDefault(); popPage(); }
});
