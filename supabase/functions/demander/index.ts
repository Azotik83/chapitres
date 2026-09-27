// ════════════════════════════════════════════════════════════════
// demander — la question des 66 jours, envoyée en notification.
//
// Appelée une fois par jour par pg_cron. Elle regarde quelles habitudes
// ont passé leur seuil sans avoir reçu de notification depuis une
// semaine, et pousse la question sur les appareils abonnés.
//
// Elle NE touche PAS last_asked_on, qui appartient à la carte affichée
// dans l'app : un push ignoré ne doit pas faire taire le canal fiable.
// Elle n'écrit que dans last_push_on.
// ════════════════════════════════════════════════════════════════

import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2.58.0";

const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";
const VAPID_PUBLIC = Deno.env.get("VAPID_PUBLIC_KEY") ?? "";
const VAPID_PRIVATE = Deno.env.get("VAPID_PRIVATE_KEY") ?? "";
const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") ?? "mailto:rien@example.com";

const URL_APP = "https://azotik83.github.io/chapitres/";

// Nombre de jours écoulés, bornes comprises — le même calcul que dans
// l'app, pour que le seuil tombe au même moment des deux côtés.
function jours(depuis: string): number {
  const a = new Date(depuis + "T00:00:00Z").getTime();
  const b = new Date(new Date().toISOString().slice(0, 10) + "T00:00:00Z").getTime();
  return Math.max(1, Math.round((b - a) / 86400000) + 1);
}

const aujourdhui = () => new Date().toISOString().slice(0, 10);

Deno.serve(async (req) => {
  // Seul le cron entre. La fonction est déployée sans vérification de
  // jeton, donc c'est ce secret partagé qui tient la porte.
  const donne = req.headers.get("x-cron-secret") ?? "";
  if (!CRON_SECRET || donne !== CRON_SECRET) {
    return new Response("non", { status: 401 });
  }
  if (!VAPID_PRIVATE || !VAPID_PUBLIC) {
    return new Response(JSON.stringify({ erreur: "clés VAPID absentes" }), { status: 500 });
  }

  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);

  // service_role : le cron n'a aucun contexte utilisateur, et la clé ne
  // vit que dans cette fonction — jamais dans la page.
  const db = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );

  const { data: habitudes, error } = await db
    .from("habits")
    .select("id, user_id, text, start_date, ask_after, last_push_on")
    .is("deleted_at", null)
    .is("anchored_at", null)
    .is("stopped_at", null);
  if (error) return new Response(JSON.stringify({ erreur: error.message }), { status: 500 });

  const jour = aujourdhui();
  const semaine = (d: string | null) => !d || jours(d) > 7;

  const dues = (habitudes ?? []).filter(
    (h) => jours(h.start_date) >= (h.ask_after ?? 66) && semaine(h.last_push_on),
  );
  if (!dues.length) return Response.json({ envoyes: 0, dues: 0 });

  // Une seule notification par personne, même si plusieurs habitudes
  // arrivent à échéance : on ne remplit pas l'écran de verrouillage.
  const parPersonne = new Map<string, typeof dues>();
  for (const h of dues) {
    if (!parPersonne.has(h.user_id)) parPersonne.set(h.user_id, []);
    parPersonne.get(h.user_id)!.push(h);
  }

  let envoyes = 0;
  let perimes = 0;

  for (const [userId, liste] of parPersonne) {
    const { data: abos } = await db
      .from("push_subscriptions")
      .select("id, endpoint, p256dh, auth")
      .eq("user_id", userId);
    if (!abos || !abos.length) continue;

    // La durée ne définit pas une habitude : l'automaticité, si. On pose
    // donc la même question que la carte dans l'app, mot pour mot.
    const corps = liste.length === 1
      ? `${jours(liste[0].start_date)} jours. Tu le fais sans y penser ?`
      : `${liste.length} habitudes ont passé leur seuil.`;
    const titre = liste.length === 1 ? liste[0].text : "Tes habitudes";

    const charge = JSON.stringify({ titre, corps, url: URL_APP });

    for (const a of abos) {
      try {
        await webpush.sendNotification(
          { endpoint: a.endpoint, keys: { p256dh: a.p256dh, auth: a.auth } },
          charge,
        );
        envoyes++;
        await db.from("push_subscriptions")
          .update({ last_ok_at: new Date().toISOString(), failures: 0 })
          .eq("id", a.id);
      } catch (e) {
        const code = (e as { statusCode?: number }).statusCode ?? 0;
        // 404/410 : l'abonnement est mort pour de bon, on le retire.
        if (code === 404 || code === 410) {
          await db.from("push_subscriptions").delete().eq("id", a.id);
          perimes++;
        } else {
          // Échec passager : on compte, sans rien casser. Un abonnement
          // qui échoue durablement finira par être nettoyé par un 410.
          await db.from("push_subscriptions")
            .update({ failures: (a as { failures?: number }).failures ?? 1 })
            .eq("id", a.id);
        }
      }
    }

    // On note l'envoi, et uniquement l'envoi.
    for (const h of liste) {
      await db.from("habits").update({ last_push_on: jour }).eq("id", h.id);
    }
  }

  return Response.json({ dues: dues.length, envoyes, perimes });
});
