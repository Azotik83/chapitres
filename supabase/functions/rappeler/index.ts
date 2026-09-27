// ════════════════════════════════════════════════════════════════
// rappeler — les rappels que tu as posés toi-même.
//
// Appelée chaque minute par pg_cron. Elle ne notifie QUE ce que tu as
// explicitement demandé, à l'heure que tu as fixée. Ce n'est pas une
// relance : c'est toi qui parles à toi-même, en différé.
//
// Une tâche déjà cochée ne réveille personne, et un rappel parti ne
// repart pas.
// ════════════════════════════════════════════════════════════════

import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2.58.0";

const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";
const VAPID_PUBLIC = Deno.env.get("VAPID_PUBLIC_KEY") ?? "";
const VAPID_PRIVATE = Deno.env.get("VAPID_PRIVATE_KEY") ?? "";
const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") ?? "mailto:rien@example.com";

const URL_APP = "https://azotik83.github.io/chapitres/";

// Les tags sont colorés à l'affichage, jamais retirés du texte. Dans une
// notification, en revanche, ils n'apportent rien : on les enlève.
const propre = (t: string) => t.replace(/#[\wÀ-ÿ-]+/g, "").replace(/\s+/g, " ").trim();

Deno.serve(async (req) => {
  if (!CRON_SECRET || (req.headers.get("x-cron-secret") ?? "") !== CRON_SECRET) {
    return new Response("non", { status: 401 });
  }
  if (!VAPID_PRIVATE || !VAPID_PUBLIC) {
    return new Response(JSON.stringify({ erreur: "clés VAPID absentes" }), { status: 500 });
  }
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);

  const db = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );

  const maintenant = new Date().toISOString();

  const { data: dus, error } = await db
    .from("entries")
    .select("id, user_id, text, remind_at")
    .lte("remind_at", maintenant)
    .is("reminded_at", null)
    .is("deleted_at", null)
    .eq("done", false)          // déjà fait : on ne réveille personne
    .limit(200);
  if (error) return new Response(JSON.stringify({ erreur: error.message }), { status: 500 });
  if (!dus || !dus.length) return Response.json({ dus: 0, envoyes: 0 });

  const parPersonne = new Map<string, typeof dus>();
  for (const e of dus) {
    if (!parPersonne.has(e.user_id)) parPersonne.set(e.user_id, []);
    parPersonne.get(e.user_id)!.push(e);
  }

  let envoyes = 0;
  let perimes = 0;
  const partis: string[] = [];

  for (const [userId, liste] of parPersonne) {
    const { data: abos } = await db
      .from("push_subscriptions")
      .select("id, endpoint, p256dh, auth")
      .eq("user_id", userId);

    // Sans appareil abonné, on NE marque PAS le rappel comme envoyé : il
    // repartira dès qu'un appareil le sera. On ne fait pas silence sur
    // ce qu'on n'a pas pu dire.
    if (!abos || !abos.length) continue;

    for (const e of liste) {
      const charge = JSON.stringify({
        titre: propre(e.text) || "Rappel",
        corps: "Rappel",
        url: URL_APP,
        // Un fil par rappel : deux rappels distincts ne s'écrasent pas.
        tag: "raptat-rappel-" + e.id,
      });

      let unSucces = false;
      for (const a of abos) {
        try {
          await webpush.sendNotification(
            { endpoint: a.endpoint, keys: { p256dh: a.p256dh, auth: a.auth } },
            charge,
          );
          envoyes++;
          unSucces = true;
          await db.from("push_subscriptions")
            .update({ last_ok_at: new Date().toISOString(), failures: 0 })
            .eq("id", a.id);
        } catch (err) {
          const code = (err as { statusCode?: number }).statusCode ?? 0;
          if (code === 404 || code === 410) {
            await db.from("push_subscriptions").delete().eq("id", a.id);
            perimes++;
          }
        }
      }
      if (unSucces) partis.push(e.id);
    }
  }

  if (partis.length) {
    await db.from("entries")
      .update({ reminded_at: new Date().toISOString() })
      .in("id", partis);
  }

  return Response.json({ dus: dus.length, envoyes, perimes });
});
