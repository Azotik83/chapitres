// ═══════════════════════════════════════════════════════════════
// today.js — Écran 1, Aujourd'hui.
//
// Il ressemble à une conversation : tu écris en bas, ça monte.
// Aucun chiffre en haut. Les chiffres vivent dans l'onglet Argent,
// et nulle part ailleurs.
// ═══════════════════════════════════════════════════════════════

import { parse, reeditable, dayLabel, today as ceJour } from "./core.js";
import * as store from "./store.js";
import { el, clear, entryRow, habitRow, attachRowGestures, actionSheet, toast } from "./ui.js";

let feed, composer, input, sendBtn, editbar, chapterLabel;
let editing = null;   // {id} quand la barre sert à modifier une ligne
let cueFor = null;    // {id} quand elle sert à noter un déclencheur

export function mount() {
  feed = document.getElementById("feed");
  composer = document.getElementById("composer");
  input = document.getElementById("line");
  sendBtn = document.getElementById("send");
  editbar = document.getElementById("editbar");
  chapterLabel = document.getElementById("chapterlabel");

  composer.addEventListener("submit", (ev) => { ev.preventDefault(); submit(); });
  input.addEventListener("input", grow);
  input.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter" && !ev.shiftKey && !ev.isComposing) { ev.preventDefault(); submit(); }
    else if (ev.key === "Escape" && (editing || cueFor)) stopEditing();
  });
  document.getElementById("editCancel").addEventListener("click", () => { stopEditing(); input.focus(); });

  attachRowGestures(feed, {
    onTap: (id, row) => {
      const hid = row && row.dataset.habit;
      if (hid) { store.toggleTick(hid, row.dataset.day || ceJour()); return; }
      toggle(id);
    },
    onHold: (id, row) => {
      const hid = row && row.dataset.habit;
      if (hid) { menuHabitude(hid); return; }
      openMenu(id);
    },
  });
  grow();
}

export function focusInput() {
  try { input.focus({ preventScroll: true }); } catch { input.focus(); }
}

/* ── Le rendu ─────────────────────────────────────────────────── */

export function render() {
  if (!feed) return;

  const c = store.currentChapter();
  if (chapterLabel) {
    // Information de contexte, pas un titre. Aucun chiffre d'argent.
    chapterLabel.textContent = c
      ? "Chapitre " + c.n + " · " + store.chapterDays(c) + " j"
      : "Chapitre 1";
  }

  const days = store.feedDays(90);
  const habitudes = store.activeHabits();
  const aujourdhui = ceJour();
  clear(feed);

  // La question des 66 jours, tout en haut — elle n'empêche pas d'écrire.
  for (const h of store.habitsToAsk()) feed.appendChild(carteQuestion(h));

  if (!days.length && !habitudes.length) {
    // Un état vide est une phrase écrite et un curseur déjà placé.
    feed.appendChild(el("p", {
      class: "blank",
      text: "Écris une ligne quand il se passe quelque chose.",
    }));
    return;
  }

  // Le jour d'aujourd'hui existe dès qu'une habitude existe, même sans
  // une seule ligne écrite : c'est tout l'intérêt d'une habitude.
  const groupes = days.slice();
  if (habitudes.length && !groupes.some((g) => g.day === aujourdhui)) {
    groupes.unshift({ day: aujourdhui, items: [] });
  }

  for (const group of groupes) {
    const sec = el("section", { class: "day" }, [
      el("h2", { class: "daylabel", text: dayLabel(group.day) }),
    ]);

    if (group.day === aujourdhui) {
      // En tête du jour : c'est pour elles qu'on ouvre l'app.
      for (const h of habitudes) {
        sec.appendChild(habitRow(h, {
          day: aujourdhui,
          ticked: store.isTicked(h.id, aujourdhui),
          days: store.habitDays(h),
        }));
      }
    } else {
      // Dans le passé, on ne montre QUE ce qui a été réellement coché.
      // Une case vide sur un jour ancien ne serait qu'un reproche.
      for (const h of store.ticksOfDay(group.day)) {
        sec.appendChild(habitRow(h, { day: group.day, ticked: true, days: 0, interactive: false }));
      }
    }

    for (const e of group.items) sec.appendChild(entryRow(e));
    feed.appendChild(sec);
  }
}

/* ── La question des 66 jours ─────────────────────────────────── */

function carteQuestion(h) {
  const j = store.habitDays(h);
  return el("div", { class: "ask" }, [
    el("p", { class: "askwhat", text: h.text }),
    el("p", { class: "askwhen", text: j + " jours · tu le fais sans y penser ?" }),
    el("div", { class: "askrow" }, [
      el("button", {
        type: "button", class: "yes", text: "Oui, sans y penser",
        onclick: async () => {
          await store.anchorHabit(h.id);
          toast("Ancrée. Elle quitte le quotidien, l'historique reste.");
        },
      }),
      el("button", {
        type: "button", text: "Pas encore",
        onclick: async () => {
          await store.snoozeHabit(h.id);
          toast("On en reparle dans une semaine.");
        },
      }),
    ]),
  ]);
}

/* ── Écrire ───────────────────────────────────────────────────── */

function grow() {
  input.style.height = "auto";
  input.style.height = Math.min(input.scrollHeight, 132) + "px";
  sendBtn.disabled = input.value.trim().length === 0;
}

async function submit() {
  const raw = input.value.trim();

  // Le déclencheur d'une habitude. Envoyer à vide l'efface — c'est la
  // façon la plus simple de revenir en arrière.
  if (cueFor) {
    const id = cueFor.id;
    stopEditing();
    await store.patchHabit(id, { cue: raw || null });
    toast(raw ? "Déclencheur noté." : "Déclencheur retiré.");
    return;
  }

  if (!raw) return;

  if (editing) {
    const id = editing.id;
    stopEditing();
    const prev = store.state.entries.get(id);
    if (!prev) return;
    const p = parse(raw);
    await store.patchEntry(id, {
      text: p.text,
      amount: p.amount,
      kind: p.kind,
      done: p.kind === "t" ? prev.done : false,
    });
    return;
  }

  const p = parse(raw);
  const e = await store.addEntry(p);
  input.value = "";
  grow();
  feed.scrollTop = 0;

  // Le message dit ce que l'app a décidé.
  const msg = p.kind === "t" ? "Tâche ajoutée"
    : p.kind === "n" ? "Noté"
      : p.amount < 0 ? "Dépense notée" : "Rentrée notée";
  toast(msg, () => store.deleteEntry(e.id));
}

function startEditing(id) {
  const e = store.state.entries.get(id);
  if (!e) return;
  editing = { id };
  editbar.hidden = false;
  input.value = reeditable(e);
  grow();
  input.focus();
  try { input.setSelectionRange(input.value.length, input.value.length); } catch { /* ignoré */ }
}

// La barre sert à noter le contexte qui déclenchera l'habitude.
// « après le café », « en sortant du studio » — pas une heure : c'est un
// repère dans la journée, pas une alarme.
function startCue(id) {
  const h = store.state.habits.get(id);
  if (!h) return;
  editing = null;
  cueFor = { id };
  editbar.hidden = false;
  editbar.querySelector(".k").textContent = "Quand ?";
  input.value = h.cue || "";
  input.placeholder = "après le café, en sortant…";
  grow();
  input.focus();
  try { input.setSelectionRange(input.value.length, input.value.length); } catch { /* ignoré */ }
}

function stopEditing() {
  editing = null;
  cueFor = null;
  editbar.hidden = true;
  editbar.querySelector(".k").textContent = "Modifier";
  input.value = "";
  input.placeholder = "écris une ligne…";
  grow();
}

/* ── Cocher, corriger, supprimer ──────────────────────────────── */

function toggle(id) {
  const e = store.state.entries.get(id);
  if (!e || e.kind !== "t") return;    // seule une tâche se coche
  store.patchEntry(id, { done: !e.done });
}

export function openMenu(id) {
  const e = store.state.entries.get(id);
  if (!e) return;
  entryMenu(e, { onEdit: () => startEditing(id) });
}

// Le menu d'une habitude. Une habitude se termine de deux façons, et
// les deux sont des réussites : elle est ancrée, ou tu l'arrêtes.
function menuHabitude(id) {
  const h = store.state.habits.get(id);
  if (!h) return;
  const j = store.habitDays(h);
  actionSheet(h.text + "  ·  " + j + " j", [
    {
      label: h.cue ? "Changer le déclencheur" : "Quand le fais-tu ?",
      run: () => startCue(id),
    },
    // La durée ne définit pas une habitude : l'automaticité, si. C'est
    // ce que mesurent les instruments validés du domaine, et c'est une
    // question à laquelle on peut répondre honnêtement.
    {
      label: "Je le fais sans y penser",
      run: async () => {
        await store.anchorHabit(id);
        toast("Ancrée. Elle quitte le quotidien, l'historique reste.");
      },
    },
    {
      label: "Arrêter cette habitude",
      run: async () => {
        await store.stopHabit(id);
        toast("Arrêtée.");
      },
    },
    {
      label: "Supprimer", tone: "danger",
      run: async () => {
        await store.deleteHabit(id);
        toast("Habitude supprimée", () => store.patchHabit(id, { deleted_at: null }));
      },
    },
    { label: "Annuler", tone: "quiet" },
  ]);
}

// Partagé avec la page d'un chapitre et celle d'un projet.
export function entryMenu(e, { onEdit } = {}) {
  const head = e.kind === "m" ? e.text : e.text;
  actionSheet(head, [
    // La nature est réversible en un geste — pour les lignes sans montant.
    e.kind === "n" ? {
      label: "En faire une tâche",
      run: () => store.patchEntry(e.id, { kind: "t", done: false }),
    } : null,
    e.kind === "t" ? {
      label: "Ce n'est pas une tâche",
      run: () => store.patchEntry(e.id, { kind: "n", done: false }),
    } : null,
    // Aucun nouveau geste, aucun nouveau symbole : une habitude se crée
    // depuis le menu qui existait déjà.
    e.kind === "t" ? {
      label: "En faire une habitude",
      run: async () => {
        const h = await store.addHabit(e.text);
        await store.deleteEntry(e.id);
        toast("Habitude créée. Elle revient chaque jour.");
        // Le déclencheur se note au moment de l'engagement, c'est là
        // qu'il vaut quelque chose. Échap suffit à l'ignorer.
        startCue(h.id);
      },
    } : null,
    onEdit ? { label: "Modifier le texte", run: onEdit } : null,
    {
      label: "Supprimer", tone: "danger",
      run: async () => {
        await store.deleteEntry(e.id);
        toast("Ligne supprimée", () => store.restoreEntry(e.id));
      },
    },
    { label: "Annuler", tone: "quiet" },
  ]);
}
