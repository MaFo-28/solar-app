/**
 * tab-material.js
 * Onglet 2 — Matériel. Fusionne les 3 bases de données (panneaux,
 * onduleurs, batteries) — chacune purement une base à gérer, sans
 * config d'installation (ça, c'est dans l'onglet Simulation). Même
 * principe pour les trois : un modèle sélectionné à la fois, actions
 * Nouveau/Dupliquer/Renommer/Supprimer, caractéristiques éditées dans
 * des champs individuels lisibles.
 */
window.TabMaterial = (function () {
  "use strict";

  /** Tri alphabétique marque puis modèle, insensible à la casse. */
  function sortedByName(list) {
    return list.slice().sort((a, b) =>
      (a.brand + " " + a.model).localeCompare(b.brand + " " + b.model, "fr", { sensitivity: "base" })
    );
  }

  function init() {
    initPanels();
    initInverters();
    initBatteries();
    initMaterialLibrary();
  }

  // ==================================================================
  // BIBLIOTHÈQUE MATÉRIEL (fichier séparé, indépendant du projet)
  // ==================================================================
  function initMaterialLibrary() {
    refreshMaterialLibraryName();

    window.bindOnce(document.getElementById("material-lib-save"), "click", async function () {
      const result = await window.AppState.saveMaterialLibrary(false);
      showLibraryStatus(result.saved ? "Bibliothèque enregistrée : " + result.filename : "Enregistrement annulé.");
      refreshMaterialLibraryName();
    });

    window.bindOnce(document.getElementById("material-lib-save-as"), "click", async function () {
      const result = await window.AppState.saveMaterialLibrary(true);
      showLibraryStatus(result.saved ? "Bibliothèque enregistrée sous : " + result.filename : "Enregistrement annulé.");
      refreshMaterialLibraryName();
    });

    window.bindOnce(document.getElementById("material-lib-load"), "click", async function () {
      try {
        const result = await window.AppState.loadMaterialLibraryViaPicker();
        if (result === null) {
          document.getElementById("material-lib-load-input").click();
          return;
        }
        if (result.loaded) {
          showLibraryStatus("Bibliothèque chargée : " + result.filename);
          refreshMaterialLibraryName();
          refreshAllAfterLibraryLoad();
        }
      } catch (err) {
        showLibraryStatus("Erreur : fichier invalide.");
        console.warn(err);
      }
    });

    window.bindOnce(document.getElementById("material-lib-load-input"), "change", function (e) {
      const file = e.target.files[0];
      if (!file) return;
      window.AppState.loadMaterialLibraryFromFile(file, function (err) {
        if (err) {
          showLibraryStatus("Erreur : fichier invalide.");
        } else {
          showLibraryStatus("Bibliothèque chargée : " + file.name);
          refreshMaterialLibraryName();
          refreshAllAfterLibraryLoad();
        }
      });
      e.target.value = "";
    });
  }

  function refreshMaterialLibraryName() {
    const el = document.getElementById("material-lib-name");
    const name = window.AppState.getCurrentMaterialFileName();
    el.textContent = name || "bibliothèque non enregistrée";
  }

  function showLibraryStatus(message) {
    const el = document.getElementById("material-lib-status");
    el.textContent = message;
    el.classList.add("is-visible");
    setTimeout(() => el.classList.remove("is-visible"), 2500);
  }

  function refreshAllAfterLibraryLoad() {
    ensurePanelSelection();
    ensureInverterSelection();
    ensureBatterySelection();
    refreshPanels();
    refreshInverters();
    refreshBatteries();
  }

  // ==================================================================
  // PANNEAUX
  // ==================================================================
  const PANEL_TEXT_FIELDS = ["brand", "model"];
  const PANEL_NUMBER_FIELDS = ["widthM", "heightM", "powerWc", "priceEur"];

  function getPanelsDatabase() {
    return window.AppState.get().panelsDatabase || [];
  }

  function getSelectedPanel() {
    const db = getPanelsDatabase();
    const s = window.AppState.get().panels;
    return db.find((p) => p.id === s.selectedModelId) || db[0] || null;
  }

  function initPanels() {
    ensurePanelSelection();
    renderPanelSelect();
    renderPanelFields();
    bindPanelSelect();
    bindPanelActions();
    bindPanelFieldInputs();
  }

  function ensurePanelSelection() {
    const db = getPanelsDatabase();
    const s = window.AppState.get().panels;
    if (db.length > 0 && !db.some((p) => p.id === s.selectedModelId)) {
      const st = window.AppState.get();
      st.panels.selectedModelId = db[0].id;
      window.AppState.set("panels", st.panels);
    }
  }

  function renderPanelSelect() {
    const select = document.getElementById("material-panel-select");
    const db = sortedByName(getPanelsDatabase());
    select.innerHTML = "";
    db.forEach((p) => {
      const opt = document.createElement("option");
      opt.value = p.id;
      opt.textContent = p.brand + " " + p.model;
      select.appendChild(opt);
    });
    const s = window.AppState.get().panels;
    select.value = s.selectedModelId || (db[0] && db[0].id) || "";
  }

  function bindPanelSelect() {
    window.bindOnce(document.getElementById("material-panel-select"), "change", function (e) {
      const st = window.AppState.get();
      st.panels.selectedModelId = e.target.value;
      window.AppState.set("panels", st.panels);
      renderPanelFields();
    });
  }

  function refreshPanels() {
    renderPanelSelect();
    renderPanelFields();
  }

  function bindPanelActions() {
    window.bindOnce(document.getElementById("material-panel-new"), "click", function () {
      const name = window.prompt('Modèle du nouveau panneau (ex. "Mono 400") :', "Nouveau modèle");
      if (!name) return;
      const st = window.AppState.get();
      const id = "panel-" + Date.now().toString(36);
      st.panelsDatabase.push({
        id, brand: "Nouvelle marque", model: name,
        widthM: 1.13, heightM: 2.28, powerWc: 400, priceEur: 200,
      });
      st.panels.selectedModelId = id;
      window.AppState.set("panelsDatabase", st.panelsDatabase);
      window.AppState.set("panels", st.panels);
      refreshPanels();
    });

    window.bindOnce(document.getElementById("material-panel-duplicate"), "click", function () {
      const current = getSelectedPanel();
      if (!current) return;
      const name = window.prompt("Modèle du duplicata :", current.model + " (copie)");
      if (!name) return;
      const st = window.AppState.get();
      const id = "panel-" + Date.now().toString(36);
      st.panelsDatabase.push(Object.assign({}, current, { id, model: name }));
      st.panels.selectedModelId = id;
      window.AppState.set("panelsDatabase", st.panelsDatabase);
      window.AppState.set("panels", st.panels);
      refreshPanels();
    });

    window.bindOnce(document.getElementById("material-panel-rename"), "click", function () {
      const current = getSelectedPanel();
      if (!current) return;
      const name = window.prompt("Nouveau nom du modèle :", current.model);
      if (!name) return;
      const st = window.AppState.get();
      const item = st.panelsDatabase.find((p) => p.id === current.id);
      item.model = name;
      window.AppState.set("panelsDatabase", st.panelsDatabase);
      refreshPanels();
    });

    window.bindOnce(document.getElementById("material-panel-delete"), "click", function () {
      const st = window.AppState.get();
      if (st.panelsDatabase.length <= 1) {
        alert("Impossible de supprimer le dernier panneau de la base.");
        return;
      }
      const current = getSelectedPanel();
      if (!current) return;
      if (!confirm('Supprimer "' + current.brand + " " + current.model + '" ? Cette action est irréversible.')) return;
      st.panelsDatabase = st.panelsDatabase.filter((p) => p.id !== current.id);
      st.panels.selectedModelId = st.panelsDatabase[0].id;
      window.AppState.set("panelsDatabase", st.panelsDatabase);
      window.AppState.set("panels", st.panels);
      refreshPanels();
    });
  }

  function renderPanelFields() {
    const item = getSelectedPanel();
    if (!item) return;
    PANEL_TEXT_FIELDS.concat(PANEL_NUMBER_FIELDS).forEach((key) => {
      const el = document.getElementById("material-panel-field-" + key);
      if (el) el.value = item[key];
    });
    const surfaceM2 = item.widthM * item.heightM;
    const efficiencyPct = surfaceM2 > 0 ? (item.powerWc / (surfaceM2 * 1000)) * 100 : 0;
    document.getElementById("material-panel-surface-display").value = surfaceM2.toFixed(2) + " m²";
    document.getElementById("material-panel-efficiency-display").value = efficiencyPct.toFixed(1) + " %";
  }

  function bindPanelFieldInputs() {
    PANEL_TEXT_FIELDS.concat(PANEL_NUMBER_FIELDS).forEach((key) => {
      const el = document.getElementById("material-panel-field-" + key);
      if (!el) return;
      window.bindOnce(el, "change", function () {
        const current = getSelectedPanel();
        if (!current) return;
        const st = window.AppState.get();
        const item = st.panelsDatabase.find((p) => p.id === current.id);
        item[key] = el.type === "number" ? parseFloat(el.value) || 0 : el.value;
        window.AppState.set("panelsDatabase", st.panelsDatabase);
        renderPanelFields(); // rafraîchit surface/rendement calculés
        if (key === "brand" || key === "model") renderPanelSelect();
      });
    });
  }

  // ==================================================================
  // ONDULEURS
  // ==================================================================
  const INVERTER_FIELDS = ["brand", "model", "ratedPowerW", "efficiencyPct", "priceEur"];

  function getInvertersDatabase() {
    return window.AppState.get().invertersDatabase || [];
  }

  function getSelectedInverter() {
    const db = getInvertersDatabase();
    const s = window.AppState.get().inverter;
    return db.find((i) => i.id === s.selectedModelId) || db[0] || null;
  }

  function initInverters() {
    ensureInverterSelection();
    renderInverterSelect();
    renderInverterFields();
    bindInverterSelect();
    bindInverterActions();
    bindInverterFieldInputs();
  }

  function ensureInverterSelection() {
    const db = getInvertersDatabase();
    const s = window.AppState.get().inverter;
    if (db.length > 0 && !db.some((i) => i.id === s.selectedModelId)) {
      const st = window.AppState.get();
      st.inverter.selectedModelId = db[0].id;
      window.AppState.set("inverter", st.inverter);
    }
  }

  function renderInverterSelect() {
    const select = document.getElementById("inverter-model-select");
    const db = sortedByName(getInvertersDatabase());
    select.innerHTML = "";
    db.forEach((inv) => {
      const opt = document.createElement("option");
      opt.value = inv.id;
      opt.textContent = inv.brand + " " + inv.model;
      select.appendChild(opt);
    });
    const s = window.AppState.get().inverter;
    select.value = s.selectedModelId || (db[0] && db[0].id) || "";
  }

  function bindInverterSelect() {
    window.bindOnce(document.getElementById("inverter-model-select"), "change", function (e) {
      const st = window.AppState.get();
      st.inverter.selectedModelId = e.target.value;
      window.AppState.set("inverter", st.inverter);
      renderInverterFields();
    });
  }

  function refreshInverters() {
    renderInverterSelect();
    renderInverterFields();
  }

  function bindInverterActions() {
    window.bindOnce(document.getElementById("inverter-new"), "click", function () {
      const name = window.prompt('Modèle du nouvel onduleur (ex. "Central 3000") :', "Nouveau modèle");
      if (!name) return;
      const st = window.AppState.get();
      const id = "inverter-" + Date.now().toString(36);
      st.invertersDatabase.push({
        id, brand: "Nouvelle marque", model: name,
        ratedPowerW: 3000, efficiencyPct: 97, priceEur: 900,
      });
      st.inverter.selectedModelId = id;
      window.AppState.set("invertersDatabase", st.invertersDatabase);
      window.AppState.set("inverter", st.inverter);
      refreshInverters();
    });

    window.bindOnce(document.getElementById("inverter-duplicate"), "click", function () {
      const current = getSelectedInverter();
      if (!current) return;
      const name = window.prompt("Modèle du duplicata :", current.model + " (copie)");
      if (!name) return;
      const st = window.AppState.get();
      const id = "inverter-" + Date.now().toString(36);
      st.invertersDatabase.push(Object.assign({}, current, { id, model: name }));
      st.inverter.selectedModelId = id;
      window.AppState.set("invertersDatabase", st.invertersDatabase);
      window.AppState.set("inverter", st.inverter);
      refreshInverters();
    });

    window.bindOnce(document.getElementById("inverter-rename"), "click", function () {
      const current = getSelectedInverter();
      if (!current) return;
      const name = window.prompt("Nouveau nom du modèle :", current.model);
      if (!name) return;
      const st = window.AppState.get();
      const item = st.invertersDatabase.find((i) => i.id === current.id);
      item.model = name;
      window.AppState.set("invertersDatabase", st.invertersDatabase);
      refreshInverters();
    });

    window.bindOnce(document.getElementById("inverter-delete"), "click", function () {
      const st = window.AppState.get();
      if (st.invertersDatabase.length <= 1) {
        alert("Impossible de supprimer le dernier onduleur de la base.");
        return;
      }
      const current = getSelectedInverter();
      if (!current) return;
      if (!confirm('Supprimer "' + current.brand + " " + current.model + '" ? Cette action est irréversible.')) return;
      st.invertersDatabase = st.invertersDatabase.filter((i) => i.id !== current.id);
      st.inverter.selectedModelId = st.invertersDatabase[0].id;
      window.AppState.set("invertersDatabase", st.invertersDatabase);
      window.AppState.set("inverter", st.inverter);
      refreshInverters();
    });
  }

  function renderInverterFields() {
    const item = getSelectedInverter();
    if (!item) return;
    INVERTER_FIELDS.forEach((key) => {
      const el = document.getElementById("inverter-field-" + key);
      if (el) el.value = item[key];
    });
  }

  function bindInverterFieldInputs() {
    INVERTER_FIELDS.forEach((key) => {
      const el = document.getElementById("inverter-field-" + key);
      if (!el) return;
      window.bindOnce(el, "change", function () {
        const current = getSelectedInverter();
        if (!current) return;
        const st = window.AppState.get();
        const item = st.invertersDatabase.find((i) => i.id === current.id);
        item[key] = el.type === "number" ? parseFloat(el.value) || 0 : el.value;
        window.AppState.set("invertersDatabase", st.invertersDatabase);
        if (key === "brand" || key === "model") renderInverterSelect();
      });
    });
  }

  // ==================================================================
  // BATTERIES
  // ==================================================================
  const BATTERY_NUMBER_FIELDS = [
    "capacityKwh", "chargePowerW", "chargeEfficiencyPct",
    "dischargePowerW", "dischargeEfficiencyPct", "solarInputEfficiencyPct",
    "guaranteedCycles", "guaranteedCyclesSoc", "priceEur",
  ];
  const BATTERY_TEXT_FIELDS = ["brand", "model"];
  const BATTERY_BOOL_FIELDS = ["hasSolarInput", "chargeSchedulable", "dischargeSchedulable"];

  function getBatteriesDatabase() {
    return window.AppState.get().batteriesDatabase || [];
  }

  function getSelectedBattery() {
    const db = getBatteriesDatabase();
    const s = window.AppState.get().battery;
    return db.find((b) => b.id === s.selectedModelId) || db[0] || null;
  }

  function initBatteries() {
    ensureBatterySelection();
    renderBatterySelect();
    renderBatteryFields();
    bindBatterySelect();
    bindBatteryActions();
    bindBatteryFieldInputs();
  }

  function ensureBatterySelection() {
    const db = getBatteriesDatabase();
    const s = window.AppState.get().battery;
    if (db.length > 0 && !db.some((b) => b.id === s.selectedModelId)) {
      const st = window.AppState.get();
      st.battery.selectedModelId = db[0].id;
      window.AppState.set("battery", st.battery);
    }
  }

  function renderBatterySelect() {
    const select = document.getElementById("battery-model-select");
    const db = sortedByName(getBatteriesDatabase());
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

  function bindBatterySelect() {
    window.bindOnce(document.getElementById("battery-model-select"), "change", function (e) {
      const st = window.AppState.get();
      st.battery.selectedModelId = e.target.value;
      window.AppState.set("battery", st.battery);
      renderBatteryFields();
    });
  }

  function refreshBatteries() {
    renderBatterySelect();
    renderBatteryFields();
  }

  function bindBatteryActions() {
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
      refreshBatteries();
    });

    window.bindOnce(document.getElementById("battery-duplicate"), "click", function () {
      const current = getSelectedBattery();
      if (!current) return;
      const name = window.prompt("Modèle du duplicata :", current.model + " (copie)");
      if (!name) return;
      const st = window.AppState.get();
      const id = "battery-" + Date.now().toString(36);
      st.batteriesDatabase.push(Object.assign({}, current, { id, model: name }));
      st.battery.selectedModelId = id;
      window.AppState.set("batteriesDatabase", st.batteriesDatabase);
      window.AppState.set("battery", st.battery);
      refreshBatteries();
    });

    window.bindOnce(document.getElementById("battery-rename"), "click", function () {
      const current = getSelectedBattery();
      if (!current) return;
      const name = window.prompt("Nouveau nom du modèle :", current.model);
      if (!name) return;
      const st = window.AppState.get();
      const item = st.batteriesDatabase.find((b) => b.id === current.id);
      item.model = name;
      window.AppState.set("batteriesDatabase", st.batteriesDatabase);
      refreshBatteries();
    });

    window.bindOnce(document.getElementById("battery-delete"), "click", function () {
      const st = window.AppState.get();
      if (st.batteriesDatabase.length <= 1) {
        alert("Impossible de supprimer la dernière batterie de la base.");
        return;
      }
      const current = getSelectedBattery();
      if (!current) return;
      if (!confirm('Supprimer "' + current.brand + " " + current.model + '" ? Cette action est irréversible.')) return;
      st.batteriesDatabase = st.batteriesDatabase.filter((b) => b.id !== current.id);
      st.battery.selectedModelId = st.batteriesDatabase[0].id;
      window.AppState.set("batteriesDatabase", st.batteriesDatabase);
      window.AppState.set("battery", st.battery);
      refreshBatteries();
    });
  }

  function renderBatteryFields() {
    const item = getSelectedBattery();
    if (!item) return;
    BATTERY_TEXT_FIELDS.concat(BATTERY_NUMBER_FIELDS).forEach((key) => {
      const el = document.getElementById("battery-field-" + key);
      if (el) el.value = item[key];
    });
    BATTERY_BOOL_FIELDS.forEach((key) => {
      const el = document.getElementById("battery-field-" + key);
      if (el) el.checked = !!item[key];
    });
  }

  function bindBatteryFieldInputs() {
    BATTERY_TEXT_FIELDS.concat(BATTERY_NUMBER_FIELDS).forEach((key) => {
      const el = document.getElementById("battery-field-" + key);
      if (!el) return;
      window.bindOnce(el, "change", function () {
        const current = getSelectedBattery();
        if (!current) return;
        const st = window.AppState.get();
        const item = st.batteriesDatabase.find((b) => b.id === current.id);
        item[key] = el.type === "number" ? parseFloat(el.value) || 0 : el.value;
        window.AppState.set("batteriesDatabase", st.batteriesDatabase);
        if (key === "brand" || key === "model") renderBatterySelect();
      });
    });
    BATTERY_BOOL_FIELDS.forEach((key) => {
      const el = document.getElementById("battery-field-" + key);
      if (!el) return;
      window.bindOnce(el, "change", function () {
        const current = getSelectedBattery();
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
