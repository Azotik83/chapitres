// ═══════════════════════════════════════════════════════════════
// today.js — Écran 1, Aujourd'hui.
//
// Il ressemble à une conversation : tu écris en bas, ça monte.
// Aucun chiffre en haut. Les chiffres vivent dans l'onglet Argent,
// et nulle part ailleurs.
// ═══════════════════════════════════════════════════════════════

import { parse, reeditable, dayLabel } from "./core.js";
import * as store from "./store.js";
import { el, clear, entryRow, attachRowGestures, actionSheet, toast } from "./ui.js";

let feed, composer, input, sendBtn, editbar, chapterLabel;
let editing = null;   // {id} quand la barre sert à modifier une ligne

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
    else if (ev.key === "Escape" && editing) stopEditing();
  });
  document.getElementById("editCancel").addEventListener("click", () => { stopEditing(); input.focus(); });

  attachRowGestures(feed, { onTap: toggle, onHold: openMenu });
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

  const days = store.entriesByDay(90);
  clear(feed);

  if (!days.length) {
    // Un état vide est une phrase écrite et un curseur déjà placé.
    feed.appendChild(el("p", {
      class: "blank",
      text: "Écris une ligne quand il se passe quelque chose.",
    }));
    return;
  }

  for (const group of days) {
    const sec = el("section", { class: "day" }, [
      el("h2", { class: "daylabel", text: dayLabel(group.day) }),
    ]);
    for (const e of group.items) sec.appendChild(entryRow(e));
    feed.appendChild(sec);
  }
}

/* ── Écrire ───────────────────────────────────────────────────── */

function grow() {
  input.style.height = "auto";
  input.style.height = Math.min(input.scrollHeight, 132) + "px";
  sendBtn.disabled = input.value.trim().length === 0;
}

async function submit() {
  const raw = input.value.trim();
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

function stopEditing() {
  editing = null;
  editbar.hidden = true;
  input.value = "";
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
