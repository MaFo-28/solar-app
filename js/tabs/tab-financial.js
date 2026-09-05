/**
 * tab-financial.js
 * Onglet 5 — Bilan financier. Viendra agréger tous les autres onglets
 * (coût matériel total, production estimée, économies, temps de
 * retour sur investissement, courbe de rentabilité cumulée).
 * Placeholder pour l'instant, en attendant les formules de calcul.
 *
 * Le matériel pris en compte est celui choisi dans la section
 * "Installation" de l'onglet Simulation (state.strategy) — c'est la
 * config qui représente ce qui est réellement installé, pas les bases
 * de données de l'onglet Matériel (qui ne font que lister les modèles
 * disponibles, sans notion de "installé").
 */
window.TabFinancial = (function () {
  "use strict";
  function init() {
    const s = window.AppState.get();
    const install = s.strategy;

    let panelCost = 0;
    const panel = (s.panelsDatabase || []).find((p) => p.id === install.panels.selectedModelId);
    if (panel) panelCost = panel.priceEur * install.panels.count;

    let inverterCost = 0;
    const inverter = (s.invertersDatabase || []).find((i) => i.id === install.inverter.selectedModelId);
    if (inverter) inverterCost = inverter.priceEur * install.inverter.count;

    let batteryCost = 0;
    const battery = (s.batteriesDatabase || []).find((b) => b.id === install.battery.selectedModelId);
    if (battery) batteryCost = battery.priceEur * install.battery.count;

    const total = panelCost + inverterCost + batteryCost;

    document.getElementById("stat-cost-panels").textContent = panelCost.toFixed(0);
    document.getElementById("stat-cost-inverter").textContent = inverterCost.toFixed(0);
    document.getElementById("stat-cost-battery").textContent = batteryCost.toFixed(0);
    document.getElementById("stat-cost-total").textContent = total.toFixed(0);
  }
  return { init };
})();
