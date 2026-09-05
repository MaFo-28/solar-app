/**
 * tab-battery.js
 * Onglet 4 — Batterie. Gère uniquement la base de données batteries
 * (même principe que les onduleurs/profils d'ombre) : un modèle
 * sélectionné à la fois, actions Nouveau/Dupliquer/Renommer/Supprimer,
 * ses caractéristiques éditées dans des champs individuels lisibles.
 */
window.TabBattery = (function () {
  "use strict";

  const NUMBER_FIELDS = [
    "capacityKwh", "chargePowerW", "chargeEfficiencyPct",
    "dischargePowerW", "dischargeEfficiencyPct", "solarInputEfficiencyPct",
    "guaranteedCycles", "guaranteedCyclesSoc", "priceEur",
  ];
  const TEXT_FIELDS = ["brand", "model"];
  const BOOL_FIELDS = ["hasSolarInput", "chargeSchedulable", "dischargeSchedulable"];

  function getDatabase() {
    return window.AppState.get().batteriesDatabase || [];
  }

  function getSelected() {
    const db = getDatabase();
    const s = window.AppState.get().battery;
    return db.find((b) => b.id === s.selectedModelId) || db[0] || null;
  }

  function init() {
    ensureSelection();
    renderSelect();
    renderFields();
    bindSelect();
    bindActions();
    bindFieldInputs();
  }

  function ensureSelection() {
    const db = getDatabase();
    const s = window.AppState.get().battery;
    if (db.length > 0 && !db.some((b) => b.id === s.selectedModelId)) {
      const st = window.AppState.get();
      st.battery.selectedModelId = db[0].id;
      window.AppState.set("battery", st.battery);
    }
  }

  function renderSelect() {
    const select = document.getElementById("battery-model-select");
    const db = getDatabase();
    select.innerHTML = "";
    db.forEach((b) => {
      const opt = document.createElement("option");
      opt.value = b.id;
      opt.textContent = b.brand + " " + b.model;
      select.appendChild(opt);
    });
    const s = window.AppState.get().battery;
    select.value = s.selectedModelId || (db[0] && db[0].id) || "";
  }

  function bindSelect() {
    window.bindOnce(document.getElementById("battery-model-select"), "change", function (e) {
      const st = window.AppState.get();
      st.battery.selectedModelId = e.target.value;
      window.AppState.set("battery", st.battery);
      renderFields();
    });
  }

  function refreshAll() {
    renderSelect();
    renderFields();
  }

  function bindActions() {
    window.bindOnce(document.getElementById("battery-new"), "click", function () {
      const name = window.prompt('Modèle de la nouvelle batterie (ex. "LFP 5kWh") :', "Nouveau modèle");
      if (!name) return;
      const st = window.AppState.get();
      const id = "battery-" + Date.now().toString(36);
      st.batteriesDatabase.push({
        id, brand: "Nouvelle marque", model: name,
        capacityKwh: 5, chargePowerW: 2500, chargeEfficiencyPct: 95,
        dischargePowerW: 2500, dischargeEfficiencyPct: 95,
        hasSolarInput: false, solarInputEfficiencyPct: 98,
        chargeSchedulable: false, dischargeSchedulable: false,
        guaranteedCycles: 6000, guaranteedCyclesSoc: 80, priceEur: 2000,
      });
      st.battery.selectedModelId = id;
      window.AppState.set("batteriesDatabase", st.batteriesDatabase);
      window.AppState.set("battery", st.battery);
      refreshAll();
    });

    window.bindOnce(document.getElementById("battery-duplicate"), "click", function () {
      const current = getSelected();
      if (!current) return;
      const name = window.prompt("Modèle du duplicata :", current.model + " (copie)");
      if (!name) return;
      const st = window.AppState.get();
      const id = "battery-" + Date.now().toString(36);
      st.batteriesDatabase.push(Object.assign({}, current, { id, model: name }));
      st.battery.selectedModelId = id;
      window.AppState.set("batteriesDatabase", st.batteriesDatabase);
      window.AppState.set("battery", st.battery);
      refreshAll();
    });

    window.bindOnce(document.getElementById("battery-rename"), "click", function () {
      const current = getSelected();
      if (!current) return;
      const name = window.prompt("Nouveau nom du modèle :", current.model);
      if (!name) return;
      const st = window.AppState.get();
      const item = st.batteriesDatabase.find((b) => b.id === current.id);
      item.model = name;
      window.AppState.set("batteriesDatabase", st.batteriesDatabase);
      refreshAll();
    });

    window.bindOnce(document.getElementById("battery-delete"), "click", function () {
      const st = window.AppState.get();
      if (st.batteriesDatabase.length <= 1) {
        alert("Impossible de supprimer la dernière batterie de la base.");
        return;
      }
      const current = getSelected();
      if (!current) return;
      if (!confirm('Supprimer "' + current.brand + " " + current.model + '" ? Cette action est irréversible.')) return;
      st.batteriesDatabase = st.batteriesDatabase.filter((b) => b.id !== current.id);
      st.battery.selectedModelId = st.batteriesDatabase[0].id;
      window.AppState.set("batteriesDatabase", st.batteriesDatabase);
      window.AppState.set("battery", st.battery);
      refreshAll();
    });
  }

  function renderFields() {
    const item = getSelected();
    if (!item) return;
    TEXT_FIELDS.concat(NUMBER_FIELDS).forEach((key) => {
      const el = document.getElementById("battery-field-" + key);
      if (el) el.value = item[key];
    });
    BOOL_FIELDS.forEach((key) => {
      const el = document.getElementById("battery-field-" + key);
      if (el) el.checked = !!item[key];
    });
  }

  function bindFieldInputs() {
    TEXT_FIELDS.concat(NUMBER_FIELDS).forEach((key) => {
      const el = document.getElementById("battery-field-" + key);
      if (!el) return;
      window.bindOnce(el, "change", function () {
        const current = getSelected();
        if (!current) return;
        const st = window.AppState.get();
        const item = st.batteriesDatabase.find((b) => b.id === current.id);
        item[key] = el.type === "number" ? parseFloat(el.value) || 0 : el.value;
        window.AppState.set("batteriesDatabase", st.batteriesDatabase);
        if (key === "brand" || key === "model") renderSelect();
      });
    });
    BOOL_FIELDS.forEach((key) => {
      const el = document.getElementById("battery-field-" + key);
      if (!el) return;
      window.bindOnce(el, "change", function () {
        const current = getSelected();
        if (!current) return;
        const st = window.AppState.get();
        const item = st.batteriesDatabase.find((b) => b.id === current.id);
        item[key] = el.checked;
        window.AppState.set("batteriesDatabase", st.batteriesDatabase);
      });
    });
  }

  return { init };
})();
