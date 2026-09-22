// ═══════════════════════════════════════════════════════════════
// config.js — ton projet Supabase.
//
// Tu peux laisser les deux champs vides : l'app a un écran de réglages
// (onglet Aujourd'hui → le bouton ⋯ en haut à droite) où les coller une
// fois. Les remplir ici t'évite de le refaire sur chaque appareil.
//
// La clé « anon » est PUBLIQUE par conception : elle est faite pour
// vivre dans le code d'une page web. Ce qui protège tes données, c'est
// le Row Level Security de supabase/schema.sql, pas le secret de cette
// clé. Ne mets JAMAIS ici la clé « service_role », qui, elle, passe
// au-dessus de toutes les politiques.
// ═══════════════════════════════════════════════════════════════

export const DEFAULT_CONFIG = {
  url: "",   // https://xxxxxxxxxxxx.supabase.co
  key: "",   // la clé « anon public »
};
