/**
 * data-panels.js
 *
 * "Base de données" des panneaux solaires. Volontairement un simple
 * tableau JS (pas un fichier .json chargé en fetch) : ouvrir le
 * fichier via file:// dans certains navigateurs bloque fetch() par
 * politique CORS locale. Un tableau JS embarqué fonctionne partout,
 * même en double-cliquant sur index.html sans serveur.
 *
 * Quelques entrées d'exemple pour démarrer — à compléter au fil de
 * l'eau. Chaque panneau :
 *  - id            : identifiant stable (ne pas changer une fois utilisé dans un projet sauvegardé)
 *  - brand, model  : affichage
 *  - widthM, heightM : dimensions en mètres (déterminent la surface,
 *    et donc le rendement calculé = powerWc / (surface × 1000))
 *  - powerWc       : puissance crête (Watt-crête, STC) — la valeur qui
 *    pilote réellement le calcul de production, le rendement affiché
 *    en est déduit plutôt que stocké séparément (évite toute
 *    incohérence entre les deux, comme c'était le cas avant)
 *  - priceEur      : prix indicatif TTC, à la pièce
 */
window.PanelsDB = [
  {
    id: "panel-example-1",
    brand: "Exemple",
    model: "Mono 400",
    widthM: 1.13,
    heightM: 1.72,
    powerWc: 400,
    priceEur: 180,
  },
  {
    id: "panel-example-2",
    brand: "Exemple",
    model: "Mono 550",
    widthM: 1.13,
    heightM: 2.28,
    powerWc: 550,
    priceEur: 230,
  },
];
