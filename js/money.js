// ═══════════════════════════════════════════════════════════════
// money.js — Écran 3, Argent.
//
// Tous les chiffres de l'app sont ici, et nulle part ailleurs.
// Un chiffre en gros, des barres, une liste.
// ═══════════════════════════════════════════════════════════════

import { fmtEuro, fmtAmount, dayLabel } from "./core.js";
import * as store from "./store.js";
import { el, clear, entryRow, page, pushPage } from "./ui.js";
import { openChapter } from "./chapters.js";

let bigEl, bigSubEl, barsEl, tagsEl, headChapter;

export function mount() {
  bigEl = document.getElementById("bignum");
  bigSubEl = document.getElementById("bigsub");
  barsEl = document.getElementById("bars");
  tagsEl = document.getElementById("tags");
  headChapter = document.getElementById("moneychapter");
}

export function render() {
  if (!bigEl) return;
  const current = store.currentChapter();
  const chapters = store.liveChapters();

  /* ── Un seul grand chiffre : ce que le chapitre en cours t'a
        rapporté ou coûté. ────────────────────────────────────── */
  const net = current ? store.chapterNet(current) : 0;
  bigEl.textContent = fmtEuro(net);
  bigEl.className = "bignum " + (net < 0 ? "out" : "in");
  const d = current ? store.chapterDays(current) : 0;
  bigSubEl.textContent = current
    ? "net de ce chapitre · " + d + (d > 1 ? " jours" : " jour")
    : "rien encore";
  if (headChapter) headChapter.textContent = current ? "Chapitre " + current.n : "";

  renderBars(chapters, current);
  renderTags();
}

/* ── Des barres, pas une courbe ───────────────────────────────── */

function renderBars(chapters, current) {
  clear(barsEl);
  if (!chapters.length) {
    barsEl.appendChild(el("p", { class: "blank", text: "Les barres apparaîtront quand tu auras fermé un chapitre." }));
    return;
  }

  // Le temps va de gauche à droite : le plus ancien à gauche, le
  // chapitre en cours à droite.
  const shown = chapters.slice(-8);
  const vals = shown.map((c) => ({ c, net: store.chapterNet(c) }));
  const maxAbs = Math.max(1, ...vals.map((v) => Math.abs(v.net)));

  const chart = el("div", { class: "chart" }, [el("div", { class: "zero" })]);

  for (const { c, net } of vals) {
    const pct = Math.max(3, Math.round((Math.abs(net) / maxAbs) * 100));
    const up = net >= 0;
    const isCurrent = current && c.id === current.id;

    const bar = el("button", {
      type: "button",
      class: "bar" + (isCurrent ? " ring" : ""),
      // Le montant est écrit sur chaque barre : le tap sert à ouvrir le
      // chapitre, pas à révéler une valeur.
      "aria-label": (c.name || "Chapitre " + c.n) + " : " + fmtEuro(net),
      onclick: () => openChapter(c.id),
    }, [
      el("div", { class: "half up" },
        up ? [el("span", { class: "barval in", text: fmtAmount(net) }),
              el("i", { class: "fill in", style: "height:" + pct + "%" })]
           : [el("i", { class: "spacer" })]),
      el("div", { class: "half down" },
        up ? [el("i", { class: "spacer" })]
           : [el("i", { class: "fill out", style: "height:" + pct + "%" }),
              el("span", { class: "barval out", text: fmtAmount(net) })]),
    ]);
    chart.appendChild(bar);
  }

  // Sans cette indication, des barres nues ne veulent rien dire.
  barsEl.appendChild(chart);
  barsEl.appendChild(el("div", { class: "axis" }, [
    el("span", { text: "plus ancien" }),
    el("span", { text: "en cours" }),
  ]));
}

/* ── Par projet ───────────────────────────────────────────────── */

function renderTags() {
  clear(tagsEl);
  const rows = store.tagTotals();
  if (!rows.length) {
    tagsEl.appendChild(el("p", {
      class: "blank",
      text: "Tes projets apparaîtront ici dès que tu écriras un #quelque-chose dans une ligne.",
    }));
    return;
  }
  // Tu n'en crées aucun : ils apparaissent quand tu les écris.
  for (const r of rows) {
    tagsEl.appendChild(el("button", {
      type: "button", class: "row tagrow",
      onclick: () => openTag(r.tag),
    }, [
      el("div", { class: "txt" }, [el("span", { class: "tag", text: "#" + r.tag })]),
      el("span", { class: "amt " + (r.net < 0 ? "out" : "in"), text: fmtEuro(r.net) }),
    ]));
  }
}

/* ── La page d'un projet ──────────────────────────────────────── */
// Tout ce qui porte ce tag, tous chapitres confondus, avec le total
// entré et sorti. C'est la rentabilité réelle d'un client, sans avoir
// rien paramétré.

export function openTag(tag) {
  const entries = store.entriesWithTag(tag);
  const inSum = entries.reduce((s, e) => s + (e.amount > 0 ? e.amount : 0), 0);
  const outSum = entries.reduce((s, e) => s + (e.amount < 0 ? e.amount : 0), 0);

  const list = el("div", { class: "list sealed" });
  let lastDay = null;
  for (const e of entries) {
    if (e.day !== lastDay) {
      list.appendChild(el("h2", { class: "daylabel", text: dayLabel(e.day) }));
      lastDay = e.day;
    }
    list.appendChild(entryRow(e, { interactive: false }));
  }

  pushPage(page({ back: "Argent", title: null }, [
    el("h1", { class: "tagtitle", text: "#" + tag }),
    el("div", { class: "three" }, [
      stat(fmtEuro(inSum), "entré", "in"),
      stat(fmtEuro(outSum), "sorti", "out"),
      stat(fmtEuro(inSum + outSum), "net", inSum + outSum < 0 ? "out" : "in"),
    ]),
    entries.length ? list : el("p", { class: "blank", text: "Plus rien ne porte ce projet." }),
  ]));
}

function stat(value, label, tone) {
  return el("div", { class: "stat" }, [
    el("div", { class: "statval" + (tone ? " " + tone : ""), text: value }),
    el("div", { class: "statlabel", text: label }),
  ]);
}
