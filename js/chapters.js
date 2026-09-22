// ═══════════════════════════════════════════════════════════════
// chapters.js — Écran 2, et la clôture.
//
// Un chapitre n'est pas une barre colorée abstraite : c'est une photo
// avec un nom dessous. Tu retrouves un chapitre à son image avant même
// d'avoir lu son nom.
// ═══════════════════════════════════════════════════════════════

import { fmtEuro, shortDate, suggestNames, dayLabel } from "./core.js";
import * as store from "./store.js";
import * as sync from "./sync.js";
import { el, clear, entryRow, attachRowGestures, page, pushPage, popPage, toast } from "./ui.js";
import { entryMenu } from "./today.js";

let grid, countEl;

export function mount() {
  grid = document.getElementById("grid");
  countEl = document.getElementById("chaptercount");
}

/* ── La photo ─────────────────────────────────────────────────── */

async function shrink(file, max = 1400, quality = 0.82) {
  let w, h, draw;
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
    const s = Math.min(1, max / Math.max(bmp.width, bmp.height));
    w = Math.round(bmp.width * s); h = Math.round(bmp.height * s);
    draw = (ctx) => ctx.drawImage(bmp, 0, 0, w, h);
  } catch {
    const url = URL.createObjectURL(file);
    const img = await new Promise((res, rej) => {
      const i = new Image();
      i.onload = () => res(i); i.onerror = rej; i.src = url;
    });
    const s = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    w = Math.round(img.naturalWidth * s); h = Math.round(img.naturalHeight * s);
    draw = (ctx) => ctx.drawImage(img, 0, 0, w, h);
    URL.revokeObjectURL(url);
  }
  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  draw(canvas.getContext("2d"));
  return new Promise((res) => canvas.toBlob(res, "image/jpeg", quality));
}

function fillPhoto(imgEl, path, fallbackNode) {
  if (!path) return;
  sync.photoURL(path).then((url) => {
    if (!url) return;
    imgEl.src = url;
    imgEl.hidden = false;
    if (fallbackNode) fallbackNode.hidden = true;
  });
}

/* ── La grille ────────────────────────────────────────────────── */

export function render() {
  if (!grid) return;
  const chapters = store.liveChapters();
  const current = store.currentChapter();
  const sealed = chapters.filter((c) => c.end_date).sort((a, b) => b.n - a.n);

  if (countEl) countEl.textContent = chapters.length ? String(chapters.length) : "";

  clear(grid);

  // La première case est le chapitre en cours. Pas de photo, des
  // pointillés, et c'est le seul endroit de l'app où se trouve Fermer.
  if (current) {
    grid.appendChild(el("div", { class: "cell current" }, [
      el("div", { class: "cellart open" }, [
        el("span", { class: "cellnum", text: "Chapitre " + current.n }),
        el("button", {
          type: "button", class: "closebtn", text: "Fermer ›",
          onclick: () => openCloseScreen(current.id),
        }),
      ]),
      el("div", { class: "cellname", text: "en cours" }),
      el("div", { class: "cellmeta", text: store.chapterDays(current) + " j" }),
    ]));
  }

  for (const c of sealed) {
    const fallback = el("div", { class: "cellfallback", text: "Chapitre " + c.n });
    const img = el("img", { class: "cellimg", alt: c.name || "Chapitre " + c.n, hidden: true, loading: "lazy" });
    const cell = el("button", {
      type: "button", class: "cell",
      onclick: () => openChapter(c.id),
    }, [
      el("div", { class: "cellart" }, [img, fallback]),
      el("div", { class: "cellname", text: c.name || "Chapitre " + c.n }),
      el("div", { class: "cellmeta", text: store.chapterDays(c) + " j" }),
    ]);
    fillPhoto(img, c.photo_path, fallback);
    grid.appendChild(cell);
  }

  if (!chapters.length) {
    grid.appendChild(el("p", { class: "blank", text: "Ton premier chapitre s'ouvre dès ta première ligne." }));
  }
}

/* ── La page d'un chapitre ────────────────────────────────────── */

export function openChapter(id) {
  const node = page({ title: null, back: "Chapitres" }, buildChapter(id));
  node.dataset.chapter = id;
  pushPage(node);
}

function buildChapter(id) {
  const c = store.state.chapters.get(id);
  if (!c) return el("p", { class: "blank", text: "Ce chapitre n'existe plus." });

  const entries = store.chapterEntries(id);
  const counts = store.chapterCounts(id);
  const net = store.chapterNet(c);
  const sealed = !!c.end_date;

  const fallback = el("div", { class: "herofallback", text: "Chapitre " + c.n });
  const img = el("img", { class: "heroimg", alt: c.name || "Chapitre " + c.n, hidden: true });
  const hero = el("div", { class: "hero" }, [img, fallback]);
  fillPhoto(img, c.photo_path, fallback);

  const body = [
    hero,
    el("h1", { class: "chaptername", text: c.name || "Chapitre " + c.n }),
    el("p", { class: "chapterdates", text: shortDate(c.start_date) + (c.end_date ? " → " + shortDate(c.end_date) : " → en cours") }),
    c.line ? el("p", { class: "chapterline", text: c.line }) : null,

    // Trois chiffres, pas un de plus.
    el("div", { class: "three" }, [
      stat(fmtEuro(net), "net", net < 0 ? "out" : "in"),
      stat(store.chapterDays(c) + " j", "durée"),
      stat(String(counts.m + counts.t + counts.n), "lignes"),
    ]),
  ];

  // Un chapitre fermé ne se modifie plus. C'est ce qui rend la
  // comparaison entre chapitres fiable — et ça supprime tout conflit de
  // synchronisation entre le téléphone et le PC.
  const list = el("div", { class: "list" + (sealed ? " sealed" : "") });
  if (!entries.length) {
    list.appendChild(el("p", { class: "blank", text: "Rien n'a encore été écrit dans ce chapitre." }));
  } else {
    let lastDay = null;
    for (const e of entries) {
      if (e.day !== lastDay) {
        list.appendChild(el("h2", { class: "daylabel", text: dayLabel(e.day) }));
        lastDay = e.day;
      }
      list.appendChild(entryRow(e, { interactive: !sealed }));
    }
  }
  if (!sealed) {
    attachRowGestures(list, {
      onTap: (eid) => {
        const e = store.state.entries.get(eid);
        if (e && e.kind === "t") store.patchEntry(eid, { done: !e.done });
      },
      // Pas de « Modifier le texte » ici : il n'y a qu'une seule zone de
      // saisie dans toute l'app, et elle vit sur l'écran Aujourd'hui.
      onHold: (eid) => {
        const e = store.state.entries.get(eid);
        if (e) entryMenu(e);
      },
    });
  }
  body.push(list);

  // « Tu peux ajouter une note en bas, datée du jour, comme une
  // annotation en marge. »
  if (sealed) body.push(annotationField(id));

  return body.filter(Boolean);
}

function stat(value, label, tone) {
  return el("div", { class: "stat" }, [
    el("div", { class: "statval" + (tone ? " " + tone : ""), text: value }),
    el("div", { class: "statlabel", text: label }),
  ]);
}

function annotationField(chapterId) {
  const input = el("input", {
    type: "text", class: "annot", id: "annot-" + chapterId,
    placeholder: "ajouter une note, datée d'aujourd'hui…",
    "aria-label": "Ajouter une note à ce chapitre",
  });
  const send = async () => {
    const raw = input.value.trim();
    if (!raw) return;
    input.value = "";
    // Une annotation est une note : elle ne peut pas fausser le net figé
    // du chapitre, ni ouvrir une case à cocher dans le passé.
    await store.addEntry({ text: raw, amount: 0, kind: "n" }, { chapterId });
    refreshOpenChapter();
    toast("Noté en marge");
  };
  input.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter" && !ev.isComposing) { ev.preventDefault(); send(); }
  });
  return el("div", { class: "annotwrap" }, [
    el("div", { class: "label", text: "En marge" }),
    el("div", { class: "annotrow" }, [
      input,
      el("button", { type: "button", class: "annotsend", text: "Ajouter", onclick: send }),
    ]),
  ]);
}

// Repeindre la page d'un chapitre ouverte, sans toucher à la pile.
export function refreshOpenChapter() {
  const host = document.getElementById("pages");
  const node = host && host.querySelector(".page[data-chapter]");
  if (!node) return;
  const id = node.dataset.chapter;
  const body = node.querySelector(".pagebody");
  clear(body);
  for (const n of [].concat(buildChapter(id))) body.appendChild(n);
}

/* ── Fermer un chapitre (§8) ──────────────────────────────────── */
// Un seul écran, trois champs, trente secondes. C'est le seul moment
// de l'app qui te demande de réfléchir.

export function openCloseScreen(chapterId) {
  const c = store.state.chapters.get(chapterId);
  if (!c || c.end_date) return;

  const entries = store.chapterEntries(chapterId);
  const [s1, s2] = suggestNames(entries, c.n);

  let blob = null;

  const preview = el("img", { class: "pickimg", alt: "", hidden: true });
  const plus = el("span", { class: "pickplus", text: "+" });
  const file = el("input", { type: "file", accept: "image/*", class: "pickinput", id: "closephoto" });
  const picker = el("label", { class: "picker", for: "closephoto" }, [preview, plus, file]);

  file.addEventListener("change", async () => {
    const f = file.files && file.files[0];
    if (!f) return;
    blob = await shrink(f);
    preview.src = URL.createObjectURL(blob);
    preview.hidden = false;
    plus.hidden = true;
  });

  const nameInput = el("input", {
    type: "text", class: "field", id: "closename",
    placeholder: "Les rushes du Vercors", "aria-label": "Le nom du chapitre",
  });
  const chip = (t) => el("button", {
    type: "button", class: "chip", text: t,
    onclick: () => { nameInput.value = t; nameInput.focus(); },
  });

  const lineInput = el("input", {
    type: "text", class: "field", id: "closeline",
    placeholder: "une phrase…", "aria-label": "Ce que j'en retiens",
  });

  const confirm = el("button", { type: "button", class: "primary", text: "Fermer ce chapitre" });

  const node = page({ back: "Annuler", title: "Fermer le chapitre", modal: true }, [
    el("div", { class: "label", text: "La photo" }),
    picker,
    el("div", { class: "label", text: "Le nom" }),
    nameInput,
    // Tu nommes le chapitre à la fin, pas au début. L'app propose deux
    // noms tirés de tes propres lignes ; tu prends ou tu écris le tien.
    el("div", { class: "chips" }, [chip(s1), chip(s2)]),
    el("div", { class: "label", text: "Ce que j'en retiens" }),
    lineInput,
    el("p", { class: "closenote", text: "Rien n'est calculé à la main : les chiffres du chapitre sont déjà faits. Le suivant s'ouvre tout seul." }),
    confirm,
  ]);

  confirm.addEventListener("click", async () => {
    confirm.disabled = true;
    let photoPath = null;
    if (blob) {
      const uid = store.state.userId || "local";
      photoPath = uid + "/" + chapterId + ".jpg";
      await store.putPhoto(photoPath, blob);
    }
    await store.closeChapter(chapterId, {
      name: nameInput.value.trim(),
      line: lineInput.value.trim(),
      photoPath,
    });
    popPage();
    toast("Chapitre " + c.n + " fermé. Le suivant est ouvert.");
  });

  pushPage(node);
  setTimeout(() => nameInput.focus(), 60);
}
