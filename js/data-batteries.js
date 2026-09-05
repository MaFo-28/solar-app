/**
 * data-batteries.js
 * Voir data-panels.js pour la logique (tableau JS embarqué, pas de fetch).
 *
 * Champs :
 *  - capacityKwh              : capacité utile, kWh
 *  - chargePowerW / dischargePowerW : puissance max de charge/décharge, W
 *  - chargeEfficiencyPct / dischargeEfficiencyPct : rendements séparés
 *  - hasSolarInput             : entrée solaire directe (MPPT intégré,
 *    panneaux connectés directement sur la batterie plutôt que via
 *    l'onduleur/le réseau AC)
 *  - solarInputEfficiencyPct   : rendement de cette entrée solaire directe
 *    (pertinent seulement si hasSolarInput est vrai)
 *  - chargeSchedulable / dischargeSchedulable : pilotage horaire
 *    programmable de la charge/décharge — très impactant pour la
 *    stratégie (ex : forcer la charge en heures creuses, ou la
 *    décharge en heures pleines)
 *  - guaranteedCycles / guaranteedCyclesSoc : nombre de cycles garantis
 *    par le fabricant, et la plage de SoC (state of charge, %) associée
 *    (souvent donnée pour une profondeur de décharge précise, ex 80%)
 */
window.BatteriesDB = [
  {
    id: "battery-example-1",
    brand: "Exemple",
    model: "LFP 5kWh",
    capacityKwh: 5,
    chargePowerW: 2500,
    chargeEfficiencyPct: 95,
    dischargePowerW: 2500,
    dischargeEfficiencyPct: 95,
    hasSolarInput: false,
    solarInputEfficiencyPct: 98,
    chargeSchedulable: true,
    dischargeSchedulable: true,
    guaranteedCycles: 6000,
    guaranteedCyclesSoc: 80,
    priceEur: 2200,
  },
];
