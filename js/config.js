// ═══════════════════════════════════════════════════════════════
// config.js — ton projet Supabase.
//
// Ces deux valeurs sont renseignées, donc tu n'as rien à saisir sur
// aucun appareil : ouvre l'adresse de l'app, connecte-toi par courriel,
// et c'est tout. L'écran de réglages (⋯ en haut à droite) permet quand
// même de les remplacer ponctuellement sur un appareil donné.
//
// La clé « publishable » (anciennement « anon ») est PUBLIQUE par
// conception : elle est faite pour vivre dans le code d'une page web,
// et elle est de toute façon visible par quiconque ouvre l'app. Ce qui
// protège tes données, ce sont les politiques RLS de
// supabase/schema.sql — vérifiées : une requête non authentifiée sur
// `entries` renvoie une liste vide, jamais une ligne.
//
// Ne mets JAMAIS ici la clé « secret » / « service_role » : celle-là
// passe au-dessus de toutes les politiques.
// ═══════════════════════════════════════════════════════════════

export const DEFAULT_CONFIG = {
  url: "https://ziskwkobxfikcbybinny.supabase.co",
  key: "sb_publishable_VVq1y1cnwIZuwMxnQ6-EgQ_5lbyl6Gk",
};
