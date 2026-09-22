// ═══════════════════════════════════════════════════════════════
// main.js — l'amorce, les trois onglets, les réglages.
//
// L'écran est peint depuis le miroir local avant toute question au
// réseau. Une ligne s'écrit toujours, connecté ou non.
// ═══════════════════════════════════════════════════════════════

import { today } from "./core.js";
import * as store from "./store.js";
import * as sync from "./sync.js";
import * as todayView from "./today.js";
import * as chaptersView from "./chapters.js";
import * as moneyView from "./money.js";
import { el, clear, page, pushPage, popPage, popAllPages, pageDepth, toast } from "./ui.js";

const TABS = ["today", "chapters", "money"];
let tab = "today";

/* ── Les onglets ──────────────────────────────────────────────── */

function showTab(name) {
  if (!TABS.includes(name)) return;
  tab = name;
  popAllPages();
  for (const t of TABS) {
    document.getElementById("screen-" + t).hidden = t !== name;
    const btn = document.getElementById("tab-" + t);
    btn.classList.toggle("on", t === name);
    btn.setAttribute("aria-current", t === name ? "page" : "false");
  }
  // La barre de saisie n'existe que là où on écrit.
  document.getElementById("composer").hidden = name !== "today";
  paint();
  if (name === "today") todayView.focusInput();
  try { sessionStorage.setItem("chapitres.tab", name); } catch { /* ignoré */ }
}

/* ── Le rendu, groupé sur une frame ───────────────────────────── */

let pending = false;
function paint() {
  if (pending) return;
  pending = true;
  const run = () => {
    if (!pending) return;               // l'autre voie est déjà passée
    pending = false;
    if (tab === "today") todayView.render();
    else if (tab === "chapters") chaptersView.render();
    else moneyView.render();
    if (pageDepth()) chaptersView.refreshOpenChapter();
  };
  // requestAnimationFrame groupe les rendus quand la page est à l'écran,
  // mais il ne tombe JAMAIS dans une fenêtre masquée ou occultée — et
  // l'app resterait blanche. Le minuteur est le filet ; le premier
  // arrivé gagne.
  requestAnimationFrame(run);
  setTimeout(run, 50);
}

/* ── Les réglages, derrière un tap ────────────────────────────── */

let settingsOpen = false;

function openSettings() {
  settingsOpen = true;
  pushPage(page({ back: "Fermer", title: "Réglages", modal: true, onBack: closeSettings },
    settingsBody()));
}

function closeSettings() {
  settingsOpen = false;
  popPage();
}

function refreshSettings() {
  if (!settingsOpen) return;
  const host = document.querySelector(".page.modal .pagebody");
  if (!host) return;
  clear(host);
  for (const n of settingsBody()) host.appendChild(n);
}

function settingsBody() {
  const s = sync.status;
  const cfg = sync.getConfig();
  const out = [];

  /* — L'état — */
  const lines = [];
  if (!cfg) lines.push("Aucun projet Supabase configuré. L'app marche, tout reste sur cet appareil.");
  else if (!s.session) lines.push("Projet configuré. Il reste à te connecter pour synchroniser.");
  else lines.push("Connecté : " + s.session.user.email);
  if (s.session) {
    lines.push(s.online ? (s.syncing ? "Synchronisation en cours…" : "À jour.") : "Hors ligne. Ce que tu écris partira au retour du réseau.");
  }
  if (s.error) lines.push("Dernière erreur : " + s.error);

  out.push(el("div", { class: "label", text: "État" }));
  out.push(el("p", { class: "settext", text: lines.join(" ") }));

  /* — Le compte — */
  if (cfg && !s.session) {
    const email = el("input", {
      type: "email", class: "field", id: "setemail", placeholder: "ton@courriel.fr",
      autocomplete: "email", "aria-label": "Ton adresse courriel",
    });
    const btn = el("button", { type: "button", class: "primary", text: "Recevoir le lien de connexion" });
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      try {
        await sync.signIn(email.value);
        toast("Lien envoyé. Ouvre-le depuis ce téléphone ou ce PC.");
      } catch (e) {
        toast("Échec : " + (e.message || e));
      } finally { btn.disabled = false; }
    });
    out.push(el("div", { class: "label", text: "Le compte" }));
    out.push(email, btn);
  }

  if (s.session) {
    out.push(el("div", { class: "label", text: "Le compte" }));
    out.push(el("button", {
      type: "button", class: "ghost", text: "Se déconnecter",
      onclick: async () => { await sync.signOut(); refreshSettings(); },
    }));
  }

  /* — Le projet Supabase — */
  const url = el("input", {
    type: "url", class: "field", id: "seturl", placeholder: "https://xxxx.supabase.co",
    value: cfg ? cfg.url : "", "aria-label": "URL du projet Supabase", autocomplete: "off",
  });
  const key = el("input", {
    type: "text", class: "field mono", id: "setkey", placeholder: "la clé anon public",
    value: cfg ? cfg.key : "", "aria-label": "Clé anon Supabase", autocomplete: "off",
  });
  const save = el("button", { type: "button", class: "primary", text: "Enregistrer et connecter" });
  save.addEventListener("click", async () => {
    try {
      sync.setConfig(url.value, key.value);
      await sync.start();
      refreshSettings();
      toast("Projet enregistré.");
    } catch (e) {
      toast("Échec : " + (e.message || e));
    }
  });
  out.push(el("div", { class: "label", text: "Le projet Supabase" }));
  out.push(url, key, save);
  out.push(el("p", {
    class: "settext dim",
    text: "La clé « anon » est publique par conception : ce sont les politiques RLS de la base qui protègent tes données, pas le secret de cette clé.",
  }));

  /* — L'export — */
  out.push(el("div", { class: "label", text: "Tes données" }));
  out.push(el("button", { type: "button", class: "ghost", text: "Exporter en JSON", onclick: exportJSON }));
  out.push(el("p", {
    class: "settext dim",
    text: store.liveEntries().length + " lignes, " + store.liveChapters().length + " chapitres sur cet appareil.",
  }));

  return out;
}

function exportJSON() {
  const data = {
    app: "chapitres",
    exported_at: new Date().toISOString(),
    chapters: store.liveChapters(),
    entries: store.liveEntries(),
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "chapitres-" + today() + ".json";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 30000);
}

/* ── Le service worker ────────────────────────────────────────── */

function registerSW() {
  if (!("serviceWorker" in navigator)) return;
  if (location.protocol !== "https:" && location.hostname !== "localhost") return;
  const base = location.pathname.replace(/[^/]*$/, "");
  navigator.serviceWorker.register(base + "sw.js", { scope: base }).catch(() => { /* pas installable, tant pis */ });
}

/* ── Démarrage ────────────────────────────────────────────────── */

async function boot() {
  await store.openDB();
  await store.loadAll();

  todayView.mount();
  chaptersView.mount();
  moneyView.mount();

  document.getElementById("tab-today").addEventListener("click", () => showTab("today"));
  document.getElementById("tab-chapters").addEventListener("click", () => showTab("chapters"));
  document.getElementById("tab-money").addEventListener("click", () => showTab("money"));
  document.getElementById("moremenu").addEventListener("click", openSettings);

  store.onChange(paint);
  sync.onStatus(refreshSettings);

  let start = "today";
  try { start = sessionStorage.getItem("chapitres.tab") || "today"; } catch { /* ignoré */ }
  showTab(TABS.includes(start) ? start : "today");

  document.getElementById("boot").hidden = true;

  registerSW();
  sync.start();

  // Le passage de minuit change « aujourd'hui » et « hier ».
  addEventListener("visibilitychange", () => { if (!document.hidden) paint(); });
}

boot().catch((e) => {
  const b = document.getElementById("boot");
  if (b) {
    b.hidden = false;
    b.textContent = "L'app n'a pas pu démarrer sur cet appareil : " + (e && e.message ? e.message : e);
  }
});
