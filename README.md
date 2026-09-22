# RAPTAT

Anciennement « Chapitres ». Une app pour écrire une ligne par jour, découper le temps en chapitres que tu fermes
toi-même, et retrouver tout ça dans une grille de photos. Trois écrans, une barre de
saisie, rien d'autre.

Elle tourne **gratuitement** : la page est hébergée sur GitHub Pages, les données dans
Supabase. Elle s'installe sur l'écran d'accueil et s'ouvre sans réseau.

### → **https://azotik83.github.io/chapitres/**

---

## Ce qu'il y a dedans

| Écran | Ce qu'il fait |
|---|---|
| **Aujourd'hui** | La liste groupée par jour, la barre de saisie, le parseur, le cochage, l'appui long. Aucun chiffre. |
| **Chapitres** | La grille de photos, le bouton Fermer, l'écran de clôture, la page d'un chapitre scellé. |
| **Argent** | Le net du chapitre en cours, une barre par chapitre, les totaux par projet, la page d'un `#tag`. |

Et : hors-ligne complet, installation sur le téléphone, synchro entre tous tes appareils.

**Sur téléphone** : une colonne, les trois onglets en bas, sous le pouce.
**Sur ordinateur** (à partir de 900 px) : les onglets passent en rail à gauche, la grille de
chapitres s'ouvre à quatre colonnes, et la colonne de lecture reste centrée à 620 px — une
ligne de texte de 1400 px de large ne se lit pas. La règle « tout ce qui se touche est dans
le tiers bas » du plan vient de la zone du pouce sur un téléphone ; elle ne veut rien dire
avec une souris.

---

## 1. Mettre la page en ligne (GitHub Pages) — *fait*

C'est déjà en place : le dépôt est public et Pages sert la branche `main` à la racine.
Le dépôt doit rester public — sur un compte GitHub gratuit, Pages ne publie que ceux-là.
Ce n'est pas un problème : il ne contient que le code de l'app, jamais tes lignes.

La procédure, pour mémoire si tu repars de zéro :

1. Sur **github.com** → **New repository**. Nom : `chapitres`. Visibilité : **Public**.
   Ne coche ni README, ni .gitignore, ni licence.

2. Dans ce dossier, branche le dépôt et pousse (remplace `TON-PSEUDO`) :

   ```bash
   git remote add origin https://github.com/Azotik83/chapitres.git
   git push -u origin main
   ```

3. Sur le dépôt → **Settings** → **Pages** → *Build and deployment* :
   **Source** = `Deploy from a branch`, **Branch** = `main`, dossier = `/ (root)` → **Save**.

4. Une minute plus tard, l'app est sur :
   **`https://azotik83.github.io/chapitres/`**

À ce stade elle marche déjà : tu peux écrire, fermer des chapitres, tout voir. Tout reste
sur l'appareil tant que tu n'as pas fait l'étape 2.

---

## 2. Brancher la base (Supabase) — *fait*

Le projet existe, le schéma est passé, le RLS est actif et vérifié, l'adresse de l'app est
autorisée, et l'URL + la clé publique sont déjà dans [`js/config.js`](js/config.js).
Il ne te reste qu'à **te connecter par courriel** dans l'app (⋯ → Réglages), sur chaque
appareil.

Les réglages appliqués au projet vivent dans [`supabase/config.toml`](supabase/config.toml) :
`supabase config push` n'écrit que les propriétés qui y sont déclarées, donc uniquement
`site_url` et `additional_redirect_urls`.

La procédure, pour mémoire si tu repars de zéro :

1. Sur **supabase.com** → **New project**. Offre gratuite, région proche de toi
   (`eu-west-3` si tu es en France). Note le mot de passe de la base quelque part :
   l'app ne s'en sert pas, mais Supabase te le redemandera un jour.

2. Menu de gauche → **SQL Editor** → **New query**. Colle tout le contenu de
   [`supabase/schema.sql`](supabase/schema.sql) → **Run**.

   Le script crée les deux tables, les index, le seau des photos, **et surtout les
   politiques RLS**. La dernière requête doit te répondre `rls_active = true` sur
   `entries` et `chapters`. Si ce n'est pas le cas, ne va pas plus loin : sans RLS,
   la clé publique de l'app suffirait à lire la base de tout le monde.

3. **Authentication** → **URL Configuration** :
   - *Site URL* : `https://azotik83.github.io/chapitres/`
   - *Redirect URLs* : ajoute la même adresse.

   Sans ça, le lien reçu par courriel te renverra vers `localhost` et la connexion
   échouera.

4. **Project Settings** → **API** : copie **Project URL** et la clé
   **`anon` / `public`** (les tableaux de bord récents l'appellent *publishable key*).
   Ne prends jamais `service_role` : celle-là passe au-dessus de toutes les politiques.

5. Ouvre l'app → bouton **⋯** en haut à droite → **Réglages** → colle l'URL et la clé →
   **Enregistrer et connecter** → tape ton adresse → **Recevoir le lien de connexion** →
   ouvre le courriel et clique le lien.

C'est fini. Les lignes déjà écrites sur l'appareil sont adoptées et envoyées
automatiquement.

> Si tu préfères ne pas le refaire sur chaque appareil, mets l'URL et la clé dans
> [`js/config.js`](js/config.js) et repousse. La clé `anon` est publique par
> conception : elle est faite pour vivre dans le code d'une page web.

---

## 2 bis. L'expéditeur de courriel (Resend)

Le service d'envoi intégré de Supabase plafonne à **2 courriels par heure** et
interdit de modifier les gabarits sur l'offre gratuite — donc pas de code à taper,
seulement un lien. Or un lien ne peut pas connecter une app installée sur l'écran
d'accueil d'un iPhone : il s'ouvre dans Safari, dont le stockage est séparé.

Resend règle les deux : 3 000 courriels par mois, gratuit, **sans posséder de domaine**.
L'expéditeur `onboarding@resend.dev` ne peut écrire qu'à l'adresse du compte Resend —
ce qui tombe bien, l'app n'écrit jamais qu'à toi.

1. Crée un compte sur **resend.com** (connexion possible avec GitHub).
2. **API Keys** → *Create API Key*, droits **Sending access**. Copie la clé `re_…`.
3. Dans ce dossier, lance **une seule commande**, en remplaçant la clé :

   ```bash
   SMTP_PASSWORD="re_ta_cle" npx --yes supabase@latest config push --project-ref ziskwkobxfikcbybinny --yes
   ```

Elle applique d'un coup : l'expéditeur, la limite remontée à 30 courriels par heure,
et le gabarit qui envoie **un code en plus du lien**.

> Toute commande `config push` ultérieure doit porter `SMTP_PASSWORD`. Sans elle le CLI
> saute silencieusement le bloc SMTP : il ne casse rien, mais ne met rien à jour non plus.

---

## 3. L'installer sur le téléphone

- **iPhone** : ouvre l'adresse dans **Safari** → bouton Partager → **Sur l'écran d'accueil**.
- **Android** : ouvre-la dans Chrome → menu ⋮ → **Installer l'application**.

Tu obtiens une vraie icône, le plein écran, et l'ouverture sans réseau. Ce que tu écris
hors ligne part tout seul au retour du réseau.

---

## 4. Modifier l'app

```bash
python serve.py          # puis http://localhost:8080
```

Un service worker ne marche pas depuis `file://` : il faut ce petit serveur, même en local.

Quand tu repousses une modification, **incrémente `VERSION` en haut de
[`sw.js`](sw.js)** (`chapitres-v1` → `chapitres-v2`). C'est ce qui dit aux téléphones
déjà installés d'aller chercher la nouvelle version tout de suite ; sans ça ils la
prendront au chargement suivant.

```bash
git add -A && git commit -m "…" && git push
```

GitHub Pages republie en une minute environ.

---

## 5. Comment c'est fait

Aucune étape de compilation, aucun `node_modules`, aucun framework. Des modules ES que
le navigateur charge directement.

```
index.html              la coquille : trois écrans, le dock, les onglets
app.css                 les jetons du design system, clair et sombre
js/core.js              le parseur, les dates, les montants, les tags
js/store.js             le miroir local (IndexedDB) et l'outbox
js/sync.js              Supabase : compte, delta, envoi, photos
js/ui.js                la ligne, l'appui long, la feuille d'action, le message
js/today.js             écran 1
js/chapters.js          écran 2 + l'écran de clôture
js/money.js             écran 3 + la page d'un projet
js/main.js              l'amorce, les onglets, les réglages
js/config.js            ton projet Supabase (facultatif)
sw.js                   le cache hors-ligne
vendor/supabase.js      le client Supabase, en un seul fichier
fonts/                  IBM Plex, en local — pour que le métro marche aussi
supabase/schema.sql     les tables, les index, le seau, et le RLS
```

### Les deux règles du modèle de données

**Une ligne est une vraie ligne de table.** Le découpage « un document par jour » de la
version artefact n'a plus lieu d'être ici : Postgres n'a pas de plafond à 5 000
documents.

**Un chapitre scellé ne se réécrit jamais.** Son `net` est figé au moment de la clôture,
sa page est en lecture seule, et on ne peut y ajouter qu'une note en marge datée du jour.
C'est ce qui garantit qu'aucune synchronisation ne peut créer de conflit sur le passé.

### La synchro

Écriture locale d'abord, toujours. Chaque mutation marque la ligne `dirty` dans
IndexedDB ; une seule boucle d'envoi tourne à la fois et vide l'outbox quand elle peut.
Le rapatriement ne demande que le delta (`updated_at > dernier passage`), et `updated_at`
est écrit par la base — jamais par l'horloge du téléphone. Les suppressions voyagent en
pierres tombales (`deleted_at`), sans quoi une ligne effacée sur le téléphone
réapparaîtrait depuis le PC.

---

## Ce que l'app ne fera jamais

Pas de notification quotidienne, pas de série à ne pas casser, pas de chiffre sur l'écran
d'écriture, pas de quatrième onglet. Rater un jour ne veut rien dire dans une app qui
compte en chapitres.
