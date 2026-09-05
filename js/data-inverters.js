/**
 * data-inverters.js
 * Voir data-panels.js pour la logique (tableau JS embarqué, pas de fetch).
 * Structure minimale pour l'instant — à affiner avec Matthieu (onglet 3
 * pas encore réfléchi en détail : rendement selon charge, micro-onduleur
 * vs onduleur central, etc.)
 */
window.InvertersDB = [
  {
    id: "inverter-example-1",
    brand: "Exemple",
    model: "Central 3000",
    ratedPowerW: 3000,
    efficiencyPct: 97.5,
    priceEur: 900,
  },
];
