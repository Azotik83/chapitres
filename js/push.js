// ═══════════════════════════════════════════════════════════════
// push.js — les notifications.
//
// Une seule sorte existe : la question des 66 jours. Pas de rappel
// quotidien — c'est ce que la règle 10 du plan interdit, et c'est la
// première fonction qu'on finit par éteindre.
//
// Sur iPhone, le push web n'existe QUE pour une app ajoutée à l'écran
// d'accueil. Dans Safari, l'API est absente et on le dit plutôt que de
// laisser un bouton qui ne ferait rien.
// ═══════════════════════════════════════════════════════════════

import { VAPID_PUBLIC_KEY } from "./config.js";
import * as sync from "./sync.js";

const supporte = () =>
  "serviceWorker" in navigator &&
  "PushManager" in window &&
  typeof Notification !== "undefined";

// Un iPhone qui n'est pas en app installée n'aura jamais l'API push.
const surIphone = () => /iPad|iPhone|iPod/.test(navigator.userAgent);
const installee = () =>
  window.matchMedia("(display-mode: standalone)").matches ||
  window.navigator.standalone === true;

function cleEnOctets(base64) {
  const bourrage = "=".repeat((4 - (base64.length % 4)) % 4);
  const propre = (base64 + bourrage).replace(/-/g, "+").replace(/_/g, "/");
  const brut = atob(propre);
  const out = new Uint8Array(brut.length);
  for (let i = 0; i < brut.length; i++) out[i] = brut.charCodeAt(i);
  return out;
}

/* ── L'état, pour que l'écran dise la vérité ──────────────────── */

export async function etat() {
  if (!supporte()) {
    return surIphone() && !installee()
      ? { code: "a-installer" }
      : { code: "impossible" };
  }
  if (Notification.permission === "denied") return { code: "refuse" };
  try {
    const reg = await navigator.serviceWorker.ready;
    const abo = await reg.pushManager.getSubscription();
    return { code: abo ? "actif" : "inactif" };
  } catch {
    return { code: "inactif" };
  }
}

/* ── Activer ──────────────────────────────────────────────────── */
// À n'appeler que depuis un vrai geste : les navigateurs refusent une
// demande de permission qui ne vient pas d'un clic.

export async function activer() {
  if (!supporte()) throw new Error("Cet appareil ne sait pas recevoir de notifications web.");

  const accord = await Notification.requestPermission();
  if (accord !== "granted") throw new Error("Permission refusée.");

  const reg = await navigator.serviceWorker.ready;
  let abo = await reg.pushManager.getSubscription();
  if (!abo) {
    abo = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: cleEnOctets(VAPID_PUBLIC_KEY),
    });
  }
  await enregistrer(abo);
  return true;
}

export async function desactiver() {
  const reg = await navigator.serviceWorker.ready;
  const abo = await reg.pushManager.getSubscription();
  if (!abo) return true;
  const point = abo.endpoint;
  try { await abo.unsubscribe(); } catch { /* on retire quand même côté base */ }
  const c = sync.client();
  if (c && sync.status.session) {
    await c.from("push_subscriptions").delete().eq("endpoint", point);
  }
  return true;
}

/* ── Enregistrer l'abonnement dans la base ────────────────────── */

async function enregistrer(abo) {
  const c = sync.client();
  if (!c || !sync.status.session) {
    throw new Error("Connecte-toi d'abord : l'abonnement se range dans ton compte.");
  }
  const brut = abo.toJSON();
  const { error } = await c.from("push_subscriptions").upsert({
    user_id: sync.status.session.user.id,
    endpoint: abo.endpoint,
    p256dh: brut.keys.p256dh,
    auth: brut.keys.auth,
    label: etiquette(),
  }, { onConflict: "endpoint" });
  if (error) throw error;
}

function etiquette() {
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/.test(ua)) return installee() ? "iPhone (app installée)" : "iPhone (Safari)";
  if (/Android/.test(ua)) return "Android";
  if (/Windows/.test(ua)) return "Windows";
  if (/Mac/.test(ua)) return "Mac";
  return "Cet appareil";
}
