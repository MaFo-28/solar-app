/**
 * tab-inverter.js
 * Onglet 3 — Onduleur. Gère uniquement la base de données onduleurs
 * (même principe que les profils d'ombre/consommation) : un modèle
 * sélectionné à la fois, actions Nouveau/Dupliquer/Renommer/Supprimer,
 * ses caractéristiques éditées dans des champs individuels lisibles.
 */
window.TabInverter = (function () {
  "use strict";

  const FIELDS = ["brand", "model", "ratedPowerW", "efficiencyPct", "priceEur"];

  function getDatabase() {
    return window.AppState.get().invertersDatabase || [];
  }

  function getSelected() {
    const db = getDatabase();
    const s = window.AppState.get().inverter;
    return db.find((i) => i.id === s.selectedModelId) || db[0] || null;
  }

  function init() {
    ensureSelection();
    renderSelect();
    renderFields();
    bindSelect();
    bindActions();
    bindFieldInputs();
  }

  /** S'assure qu'un modèle est sélectionné dès qu'il en existe un. */
  function ensureSelection() {
    const db = getDatabase();
    const s = window.AppState.get().inverter;
    if (db.length > 0 && !db.some((i) => i.id === s.selectedModelId)) {
      const st = window.AppState.get();
      st.inverter.selectedModelId = db[0].id;
      window.AppState.set("inverter", st.inverter);
    }
  }

  function renderSelect() {
    const select = document.getElementById("inverter-model-select");
    const db = getDatabase();
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

  function bindSelect() {
    window.bindOnce(document.getElementById("inverter-model-select"), "change", function (e) {
      const st = window.AppState.get();
      st.inverter.selectedModelId = e.target.value;
      window.AppState.set("inverter", st.inverter);
      renderFields();
    });
  }

  function refreshAll() {
    renderSelect();
    renderFields();
  }

  function bindActions() {
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
      refreshAll();
    });

    window.bindOnce(document.getElementById("inverter-duplicate"), "click", function () {
      const current = getSelected();
      if (!current) return;
      const name = window.prompt("Modèle du duplicata :", current.model + " (copie)");
      if (!name) return;
      const st = window.AppState.get();
      const id = "inverter-" + Date.now().toString(36);
      st.invertersDatabase.push(Object.assign({}, current, { id, model: name }));
      st.inverter.selectedModelId = id;
      window.AppState.set("invertersDatabase", st.invertersDatabase);
      window.AppState.set("inverter", st.inverter);
      refreshAll();
    });

    window.bindOnce(document.getElementById("inverter-rename"), "click", function () {
      const current = getSelected();
      if (!current) return;
      const name = window.prompt("Nouveau nom du modèle :", current.model);
      if (!name) return;
      const st = window.AppState.get();
      const item = st.invertersDatabase.find((i) => i.id === current.id);
      item.model = name;
      window.AppState.set("invertersDatabase", st.invertersDatabase);
      refreshAll();
    });

    window.bindOnce(document.getElementById("inverter-delete"), "click", function () {
      const st = window.AppState.get();
      if (st.invertersDatabase.length <= 1) {
        alert("Impossible de supprimer le dernier onduleur de la base.");
        return;
      }
      const current = getSelected();
      if (!current) return;
      if (!confirm('Supprimer "' + current.brand + " " + current.model + '" ? Cette action est irréversible.')) return;
      st.invertersDatabase = st.invertersDatabase.filter((i) => i.id !== current.id);
      st.inverter.selectedModelId = st.invertersDatabase[0].id;
      window.AppState.set("invertersDatabase", st.invertersDatabase);
      window.AppState.set("inverter", st.inverter);
      refreshAll();
    });
  }

  function renderFields() {
    const item = getSelected();
    if (!item) return;
    FIELDS.forEach((key) => {
      const el = document.getElementById("inverter-field-" + key);
      if (el) el.value = item[key];
    });
  }

  function bindFieldInputs() {
    FIELDS.forEach((key) => {
      const el = document.getElementById("inverter-field-" + key);
      if (!el) return;
      window.bindOnce(el, "change", function () {
        const current = getSelected();
        if (!current) return;
        const st = window.AppState.get();
        const item = st.invertersDatabase.find((i) => i.id === current.id);
        item[key] = el.type === "number" ? parseFloat(el.value) || 0 : el.value;
        window.AppState.set("invertersDatabase", st.invertersDatabase);
        if (key === "brand" || key === "model") renderSelect();
      });
    });
  }

  return { init };
})();
