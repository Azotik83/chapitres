-- ════════════════════════════════════════════════════════════════
-- Chapitres — schéma Supabase
--
-- À coller en une fois dans l'éditeur SQL de ton projet Supabase
-- (menu de gauche : SQL Editor → New query → coller → Run).
-- Le script est rejouable : le relancer ne casse rien.
-- ════════════════════════════════════════════════════════════════

create extension if not exists pgcrypto;

-- ── Les chapitres ───────────────────────────────────────────────
create table if not exists public.chapters (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users on delete cascade,
  n           int  not null,
  name        text,
  photo_path  text,
  line        text,
  start_date  date not null,
  end_date    date,                       -- null = le chapitre en cours
  net         numeric(10,2) not null default 0,
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);

-- ── Les lignes ──────────────────────────────────────────────────
-- En voie B une ligne redevient une vraie ligne de table : le
-- découpage « un document par jour » de la voie A disparaît.
create table if not exists public.entries (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users on delete cascade,
  chapter_id  uuid references public.chapters(id) on delete set null,
  day         date not null,
  created_at  timestamptz not null default now(),
  text        text not null,
  amount      numeric(10,2) not null default 0,
  kind        char(1) not null check (kind in ('m','t','n')),
  done        boolean not null default false,
  -- Un rappel pose sur une tache : une date et une heure, rien d'autre.
  -- remind_at est en UTC ; c'est le navigateur qui convertit l'heure
  -- locale saisie. reminded_at evite le double envoi.
  remind_at   timestamptz,
  reminded_at timestamptz,
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz                 -- pierre tombale : propage la
                                          -- suppression aux autres appareils
);

create index if not exists entries_user_day_idx      on public.entries  (user_id, day desc);
create index if not exists entries_user_updated_idx  on public.entries  (user_id, updated_at);
create index if not exists entries_chapter_idx       on public.entries  (chapter_id);

-- L'index ne porte que sur ce que le cron cherche : les rappels dus et
-- pas encore envoyes. Il reste minuscule quoi qu'il arrive.
create index if not exists entries_rappels_idx on public.entries (remind_at)
  where remind_at is not null and reminded_at is null and deleted_at is null;
create index if not exists chapters_user_updated_idx on public.chapters (user_id, updated_at);

-- Volontairement NON unique sur (user_id, n).
--
-- Un index unique paraissait protéger la numérotation des chapitres,
-- mais il transformait un cas rare — deux appareils qui numérotent en
-- même temps hors ligne — en panne totale : l'envoi des chapitres
-- échoue, et comme une ligne référence son chapitre, l'envoi des
-- lignes est bloqué derrière, indéfiniment.
--
-- Un numéro en double est un défaut d'affichage ; une synchro coincée
-- est une perte de données. L'app réconcilie les chapitres ouverts en
-- double côté client (store.reconcileOpenChapters).
create index if not exists chapters_user_n_idx on public.chapters (user_id, n);

-- ── updated_at, tenu par la base ────────────────────────────────
-- C'est ce champ que la synchro lit pour ne retélécharger que le delta.
-- Il doit venir de l'horloge du serveur, jamais de celle du téléphone.
-- clock_timestamp() et non now() : now() rend l'heure de DÉBUT DE
-- TRANSACTION, donc un envoi groupé de 300 lignes leur donnerait à
-- toutes le même updated_at — et la pagination du delta tournerait en
-- rond sur la même page. clock_timestamp() avance à chaque ligne.
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = clock_timestamp();
  return new;
end $$;

drop trigger if exists chapters_touch on public.chapters;
create trigger chapters_touch before insert or update on public.chapters
  for each row execute function public.touch_updated_at();

drop trigger if exists entries_touch on public.entries;
create trigger entries_touch before insert or update on public.entries
  for each row execute function public.touch_updated_at();

-- ── Row Level Security ──────────────────────────────────────────
-- CES LIGNES NE SONT PAS OPTIONNELLES. Sans elles, la clé publique de
-- l'app suffit à lire la base de tout le monde. C'est l'erreur la plus
-- courante sur ce genre de projet.
alter table public.entries  enable row level security;
alter table public.chapters enable row level security;

drop policy if exists "mes lignes" on public.entries;
create policy "mes lignes" on public.entries
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "mes chapitres" on public.chapters;
create policy "mes chapitres" on public.chapters
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ── Les photos de couverture ────────────────────────────────────
-- Un seau privé. Chaque photo vit dans un dossier au nom de son
-- propriétaire : <uid>/<id du chapitre>.jpg
insert into storage.buckets (id, name, public)
values ('photos', 'photos', false)
on conflict (id) do nothing;

drop policy if exists "mes photos" on storage.objects;
create policy "mes photos" on storage.objects
  for all to authenticated
  using      (bucket_id = 'photos' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'photos' and (storage.foldername(name))[1] = auth.uid()::text);

-- ── Le temps réel ───────────────────────────────────────────────
-- Pour qu'une ligne écrite sur le téléphone apparaisse sur le PC sans
-- rien toucher. Pur confort : si ça échoue, l'app rattrape au retour
-- sur l'onglet.
do $$
begin
  begin
    alter publication supabase_realtime add table public.entries;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.chapters;
  exception when duplicate_object then null;
  end;
end $$;

-- ════════════════════════════════════════════════════════════════
-- Les habitudes
--
-- Une habitude est une ligne qui revient chaque jour sans qu'on ait
-- rien a ecrire. Son compteur n'est PAS une serie : il ne se remet
-- jamais a zero, il ne se « casse » pas. Il existe pour que l'habitude
-- puisse etre supprimee une fois ancree — c'est un compteur qui vise
-- sa propre fin.
-- ════════════════════════════════════════════════════════════════

create table if not exists public.habits (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users on delete cascade,
  text        text not null,
  -- Le declencheur : « apres le cafe », « en sortant du studio ». Ni une
  -- heure ni un rappel — un CONTEXTE. C'est l'intention d'implementation
  -- de Gollwitzer, et elle agit la ou l'app etait faible : elle aidait a
  -- tenir une habitude, pas a la declencher.
  cue         text,
  start_date  date not null,
  anchored_at date,          -- ancree : elle quitte le quotidien, l'historique reste
  stopped_at  date,          -- arretee sans avoir ete ancree
  ask_after   int  not null default 66,   -- le seuil de la question
  last_asked_on date,        -- pour redemander une fois par semaine
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);

-- Un cochage. La PRESENCE de la ligne vaut « fait » ; decocher pose une
-- pierre tombale. Volontairement SANS index unique sur (habit_id, day) :
-- un doublon est un defaut d'affichage qu'on deduplique a la lecture,
-- alors qu'une contrainte violee bloquerait toute la synchro.
create table if not exists public.habit_ticks (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users on delete cascade,
  habit_id    uuid not null references public.habits(id) on delete cascade,
  day         date not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);

create index if not exists habits_user_updated_idx on public.habits (user_id, updated_at);
create index if not exists ticks_user_updated_idx  on public.habit_ticks (user_id, updated_at);
create index if not exists ticks_habit_day_idx     on public.habit_ticks (habit_id, day);

-- updated_at tenu par la base, en clock_timestamp() pour que deux lignes
-- d'un meme envoi groupe n'aient pas le meme horodatage.
drop trigger if exists habits_touch on public.habits;
create trigger habits_touch before insert or update on public.habits
  for each row execute function public.touch_updated_at();

drop trigger if exists ticks_touch on public.habit_ticks;
create trigger ticks_touch before insert or update on public.habit_ticks
  for each row execute function public.touch_updated_at();

-- ── Row Level Security ──────────────────────────────────────────
alter table public.habits      enable row level security;
alter table public.habit_ticks enable row level security;

drop policy if exists "mes habitudes" on public.habits;
create policy "mes habitudes" on public.habits
  for all to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "mes cochages" on public.habit_ticks;
create policy "mes cochages" on public.habit_ticks
  for all to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ── Temps reel ──────────────────────────────────────────────────
do $$
begin
  begin alter publication supabase_realtime add table public.habits;      exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.habit_ticks; exception when duplicate_object then null; end;
end $$;

-- ════════════════════════════════════════════════════════════════
-- Les notifications
--
-- Une seule sorte existe : la question des 66 jours. Pas de rappel
-- quotidien — c'est ce que la regle 10 du plan interdit.
-- ════════════════════════════════════════════════════════════════

create table if not exists public.push_subscriptions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users on delete cascade,
  endpoint   text not null unique,
  p256dh     text not null,
  auth       text not null,
  label      text,
  created_at timestamptz not null default now(),
  last_ok_at timestamptz,
  failures   int not null default 0
);
create index if not exists push_user_idx on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;
drop policy if exists "mes abonnements" on public.push_subscriptions;
create policy "mes abonnements" on public.push_subscriptions
  for all to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- La notification a son propre rythme, SEPARE de la question posee dans
-- l'app : si on partageait last_asked_on, un push ignore ferait taire la
-- carte dans l'app pendant une semaine — or c'est elle le canal fiable.
alter table public.habits add column if not exists last_push_on date;

-- ── Vérification ────────────────────────────────────────────────
-- Les deux lignes suivantes doivent rendre rowsecurity = true.
-- Si ce n'est pas le cas, ne mets pas l'app en ligne.
select relname, relrowsecurity as rls_active
from pg_class
where relname in ('entries', 'chapters', 'habits', 'habit_ticks');
