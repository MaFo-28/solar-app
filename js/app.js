/**
 * app.js
 * Point d'entrée de l'application : gère la navigation entre onglets
 * et initialise chaque module d'onglet au premier affichage (puis à
 * chaque fois qu'un projet est chargé, voir refreshAllTabs).
 */
window.App = (function () {
  "use strict";

  const TAB_MODULES = {
    location: window.TabLocation,
    material: window.TabMaterial,
    consumption: window.TabConsumption,
    installation: window.TabInstallation,
    simulation: window.TabSimulation,
    financial: window.TabFinancial,
  };

  const initialized = {};

  function initTab(tabId) {
    const mod = TAB_MODULES[tabId];
    if (mod && mod.init) {
      mod.init();
      initialized[tabId] = true;
    }
  }

  function showTab(tabId) {
    document.querySelectorAll(".tab-nav__item").forEach((btn) => {
      btn.classList.toggle("is-active", btn.dataset.tab === tabId);
    });
    document.querySelectorAll(".tab-panel").forEach((panel) => {
      panel.classList.toggle("is-active", panel.id === "tab-" + tabId);
    });
    if (!initialized[tabId]) {
      initTab(tabId);
    }
  }

  /** Ré-initialise tous les onglets déjà visités (utilisé après un chargement de projet). */
  function refreshAllTabs() {
    Object.keys(initialized).forEach((tabId) => {
      initTab(tabId);
    });
  }

  function bindNav() {
    document.querySelectorAll(".tab-nav__item").forEach((btn) => {
      btn.addEventListener("click", function () {
        showTab(btn.dataset.tab);
      });
    });
  }

  function init() {
    bindNav();
    window.ProjectHeader.init();
    showTab("location"); // onglet de démarrage
  }

  document.addEventListener("DOMContentLoaded", init);

  return { showTab, refreshAllTabs };
})();
