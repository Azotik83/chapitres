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

  /* — Le compte, en premier : c'est la seule chose à faire ici. — */
  out.push(el("div", { class: "label", text: "Ton compte" }));

  if (s.session) {
    out.push(el("p", { class: "settext" }, [
      "Connecté en tant que ",
      el("strong", { text: s.session.user.email }),
      ". ",
      s.online
        ? (s.syncing ? "Synchronisation en cours…" : "Tout est à jour sur tes appareils.")
        : "Hors ligne — ce que tu écris partira au retour du réseau.",
    ]));
    out.push(el("button", {
      type: "button", class: "ghost", text: "Se déconnecter",
      onclick: async () => { await sync.signOut(); refreshSettings(); },
    }));
    out.push(el("p", {
      class: "settext dim",
      text: "Te déconnecter n'efface rien : tes lignes restent sur cet appareil.",
    }));
  } else if (cfg) {
    out.push(el("p", {
      class: "settext",
      text: "Tes lignes ne sont que sur cet appareil. Connecte-toi pour les retrouver partout — "
        + "pas de mot de passe, on t'envoie un lien.",
    }));
    const email = el("input", {
      type: "email", class: "field", id: "setemail", placeholder: "ton@courriel.fr",
      autocomplete: "email", inputmode: "email", "aria-label": "Ton adresse courriel",
    });
    const btn = el("button", { type: "button", class: "primary", text: "Recevoir mon code" });

    // Le code reçu par courriel : visible seulement une fois l'envoi
    // parti, pour ne pas montrer un champ qui n'a encore aucun sens.
    const code = el("input", {
      type: "text", class: "field mono code", id: "setcode",
      placeholder: "le code du courriel", "aria-label": "Le code reçu par courriel",
      inputmode: "numeric", autocomplete: "one-time-code",
      autocapitalize: "off", spellcheck: "false",
    });
    const codeBtn = el("button", { type: "button", class: "primary", text: "Me connecter" });
    const codeBox = el("div", { hidden: true }, [
      el("p", {
        class: "settext",
        text: "Tape le code du courriel ici — c'est le chemin qui marche partout, "
          + "y compris dans l'app installée sur ton écran d'accueil.",
      }),
      code, codeBtn,
    ]);

    const send = async () => {
      if (!email.value.trim()) { email.focus(); return; }
      btn.disabled = true;
      const was = btn.textContent;
      btn.textContent = "Envoi…";
      try {
        await sync.signIn(email.value);
        toast("Courriel envoyé.");
        btn.textContent = "Renvoyer un code";
        btn.disabled = false;
        codeBox.hidden = false;
        code.focus();
      } catch (e) {
        toast("Échec : " + (e.message || e));
        btn.textContent = was;
        btn.disabled = false;
      }
    };

    const useCode = async () => {
      if (!code.value.trim()) { code.focus(); return; }
      codeBtn.disabled = true;
      const was = codeBtn.textContent;
      codeBtn.textContent = "Vérification…";
      try {
        await sync.signInWithCode(email.value, code.value);
        toast("Connecté.");
        refreshSettings();
      } catch (e) {
        toast("Échec : " + (e.message || e));
        codeBtn.textContent = was;
        codeBtn.disabled = false;
      }
    };

    btn.addEventListener("click", send);
    email.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" && !ev.isComposing) { ev.preventDefault(); send(); }
    });
    codeBtn.addEventListener("click", useCode);
    code.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" && !ev.isComposing) { ev.preventDefault(); useCode(); }
    });

    out.push(email, btn, codeBox);
    out.push(el("p", {
      class: "settext dim",
      text: "Le courriel porte un code et un lien. Le code marche partout ; "
        + "le lien seulement si tu l'ouvres sur cet appareil-ci.",
    }));

    /* — Coller le lien : indispensable pour une app installée — */
    const paste = el("input", {
      type: "url", class: "field mono", id: "setlink",
      placeholder: "https://…", "aria-label": "Le lien reçu par courriel",
      autocomplete: "off", autocapitalize: "off", spellcheck: "false",
    });
    const useLink = el("button", { type: "button", class: "ghost", text: "Me connecter avec ce lien" });
    const apply = async () => {
      if (!paste.value.trim()) { paste.focus(); return; }
      useLink.disabled = true;
      const was = useLink.textContent;
      useLink.textContent = "Vérification…";
      try {
        await sync.signInWithLink(paste.value);
        toast("Connecté.");
        refreshSettings();
      } catch (e) {
        toast("Échec : " + (e.message || e));
        useLink.textContent = was;
        useLink.disabled = false;
      }
    };
    useLink.addEventListener("click", apply);
    paste.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" && !ev.isComposing) { ev.preventDefault(); apply(); }
    });

    out.push(el("details", { class: "fold" }, [
      el("summary", { text: "Le lien s'ouvre ailleurs ?" }),
      el("p", {
        class: "settext dim",
        text: "Si tu as ajouté l'app à ton écran d'accueil, le lien du courriel "
          + "s'ouvrira dans Safari — et une app installée ne partage pas son "
          + "stockage avec Safari, donc elle resterait déconnectée. Dans le "
          + "courriel, appuie longuement sur le lien, choisis « Copier le lien », "
          + "et colle-le ici.",
      }),
      paste, useLink,
    ]));
  } else {
    out.push(el("p", {
      class: "settext",
      text: "Aucune base n'est branchée sur cet appareil. L'app marche quand même, "
        + "mais tout reste ici. Renseigne un projet ci-dessous.",
    }));
  }

  if (s.error) {
    out.push(el("p", { class: "settext dim", text: "Dernière erreur : " + s.error }));
  }

  /* — Tes données — */
  out.push(el("div", { class: "label", text: "Tes données" }));
  out.push(el("p", {
    class: "settext",
    text: store.liveEntries().length + " lignes et " + store.liveChapters().length
      + " chapitres sur cet appareil.",
  }));
  out.push(el("button", { type: "button", class: "ghost", text: "Exporter en JSON", onclick: exportJSON }));

  /* — Ce qui protège tes données. — */
  //
  // On n'affiche plus ni l'adresse du projet ni la clé. Non pas qu'elles
  // soient secrètes — elles ne peuvent pas l'être, n'importe qui peut
  // les lire dans le code d'une page web — mais parce que les montrer
  // laissait croire qu'il fallait les cacher. Ce qui protège les
  // données, ce sont les politiques de la base.
  out.push(el("details", { class: "fold" }, [
    el("summary", { text: "Sécurité" }),
    el("p", {
      class: "settext dim",
      text: "L'app s'adresse à la base avec une clé dite publique, faite pour "
        + "vivre dans le code d'une page web. Ce n'est pas elle qui protège "
        + "tes lignes : c'est le Row Level Security de la base, qui n'accorde "
        + "chaque ligne qu'au compte qui l'a écrite. Vérifié — un visiteur non "
        + "connecté ne lit rien et ne peut rien écrire.",
    }),
    el("p", {
      class: "settext dim",
      text: "Les inscriptions sont fermées : personne d'autre ne peut se créer "
        + "de compte sur ce projet, même en trouvant l'adresse du site.",
    }),
    el("p", {
      class: "settext dim",
      text: "Pour pointer cet appareil vers un autre projet, change js/config.js "
        + "et republie.",
    }),
  ]));

  return out;
}

/* ── La ligne « connecte-toi », tant qu'il n'y a pas de compte ─── */

function renderSignin() {
  const bar = document.getElementById("signinbar");
  if (!bar) return;
  const s = sync.status;
  // Une fois connecté, elle disparaît pour de bon : rien ne s'affiche
  // tant que ça n'a pas de raison d'être là.
  if (s.session) { bar.hidden = true; return; }
  document.getElementById("signintext").textContent =
    sync.getConfig() ? "Tes lignes restent sur cet appareil." : "Aucune base branchée.";
  bar.hidden = false;
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
  document.getElementById("signinbtn").addEventListener("click", openSettings);

  store.onChange(paint);
  sync.onStatus(() => { refreshSettings(); renderSignin(); });
  renderSignin();

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
