/**
 * tab-installation.js
 * Onglet 4 — Installation. Gère les profils d'installation comme une
 * base de données (même principe que Matériel et Consommation) : un
 * profil sélectionné à la fois, actions Nouveau/Dupliquer/Renommer/
 * Supprimer, regroupant le choix du matériel, les stratégies de
 * charge/décharge/vente, et des coûts fixes additionnels. Permet de
 * comparer plusieurs configurations (ex: "4 panneaux + micro-onduleur"
 * vs "8 panneaux + telle batterie") sans se marcher dessus.
 *
 * Le prix de l'installation est recalculé à chaque modification, à
 * partir des prix unitaires des bases de l'onglet Matériel et des
 * lignes de coût fixe.
 */
window.TabInstallation = (function () {
  "use strict";

  function getProfiles() {
    return window.AppState.get().installationProfiles || [];
  }

  function getActiveProfile() {
    const profiles = getProfiles();
    const s = window.AppState.get();
    return profiles.find((p) => p.id === s.activeInstallationProfileId) || profiles[0] || null;
  }

  function init() {
    ensureSelection();
    renderProfileSelect();
    bindProfileButtons();
    renderPanelSelect();
    renderMaskSelect();
    renderInverterSelect();
    renderBatterySelect();
    bindFields();
    bindStrategyFields();
    renderFixedCostTable();
    bindFixedCostAdd();
    recomputePrice();
    bindDatabaseChangeListener();
  }

  function ensureSelection() {
    const profiles = getProfiles();
    const s = window.AppState.get();
    if (profiles.length > 0 && !profiles.some((p) => p.id === s.activeInstallationProfileId)) {
      window.AppState.set("activeInstallationProfileId", profiles[0].id);
    }
  }

  /**
   * Ré-affiche tout l'onglet pour le profil actif. bindFields et
   * bindStrategyFields sont rappelés volontairement : ils réécrivent la
   * valeur de chaque champ depuis le profil (leur attachement
   * d'écouteur, lui, est protégé par bindOnce). Sans ça, changer de
   * profil laisserait les champs numériques et les listes de stratégie
   * sur les valeurs du profil précédent.
   */
  function refreshAll() {
    renderProfileSelect();
    renderPanelSelect();
    renderMaskSelect();
    renderInverterSelect();
    renderBatterySelect();
    bindFields();
    bindStrategyFields();
    renderFixedCostTable();
    recomputePrice();
  }

  // ------------------------------------------------------------------
  // Sélecteur et actions sur les profils d'installation
  // ------------------------------------------------------------------
  function renderProfileSelect() {
    const select = document.getElementById("install-profile-select");
    const profiles = getProfiles();
    select.innerHTML = "";
    profiles.forEach((p) => {
      const opt = document.createElement("option");
      opt.value = p.id;
      opt.textContent = p.name;
      select.appendChild(opt);
    });
    const s = window.AppState.get();
    select.value = s.activeInstallationProfileId || (profiles[0] && profiles[0].id) || "";
  }

  function newProfileId() {
    return "install-profile-" + Date.now().toString(36);
  }

  function bindProfileButtons() {
    window.bindOnce(document.getElementById("install-profile-select"), "change", function (e) {
      window.AppState.set("activeInstallationProfileId", e.target.value);
      refreshAll();
    });

    window.bindOnce(document.getElementById("install-profile-new"), "click", function () {
      const name = window.prompt('Nom du nouveau profil (ex. "8 panneaux + batterie") :', "Nouveau profil");
      if (!name) return;
      const st = window.AppState.get();
      const id = newProfileId();
      st.installationProfiles.push(window.AppState.createInstallationProfile(id, name));
      window.AppState.set("installationProfiles", st.installationProfiles);
      window.AppState.set("activeInstallationProfileId", id);
      refreshAll();
    });

    window.bindOnce(document.getElementById("install-profile-duplicate"), "click", function () {
      const current = getActiveProfile();
      if (!current) return;
      const name = window.prompt("Nom du duplicata :", current.name + " (copie)");
      if (!name) return;
      const st = window.AppState.get();
      const id = newProfileId();
      const copy = JSON.parse(JSON.stringify(current));
      copy.id = id;
      copy.name = name;
      st.installationProfiles.push(copy);
      window.AppState.set("installationProfiles", st.installationProfiles);
      window.AppState.set("activeInstallationProfileId", id);
      refreshAll();
    });

    window.bindOnce(document.getElementById("install-profile-rename"), "click", function () {
      const current = getActiveProfile();
      if (!current) return;
      const name = window.prompt("Nouveau nom du profil :", current.name);
      if (!name) return;
      const st = window.AppState.get();
      const item = st.installationProfiles.find((p) => p.id === current.id);
      item.name = name;
      window.AppState.set("installationProfiles", st.installationProfiles);
      renderProfileSelect();
    });

    window.bindOnce(document.getElementById("install-profile-delete"), "click", function () {
      const st = window.AppState.get();
      if (st.installationProfiles.length <= 1) {
        alert("Impossible de supprimer le dernier profil d'installation.");
        return;
      }
      const current = getActiveProfile();
      if (!current) return;
      if (!confirm('Supprimer le profil "' + current.name + '" ? Cette action est irréversible.')) return;
      st.installationProfiles = st.installationProfiles.filter((p) => p.id !== current.id);
      window.AppState.set("installationProfiles", st.installationProfiles);
      window.AppState.set("activeInstallationProfileId", st.installationProfiles[0].id);
      refreshAll();
    });
  }

  // ------------------------------------------------------------------
  // Choix du matériel
  // ------------------------------------------------------------------
  /** Tri alphabétique marque puis modèle, insensible à la casse. */
  function sortedByName(list) {
    return list.slice().sort((a, b) =>
      (a.brand + " " + a.model).localeCompare(b.brand + " " + b.model, "fr", { sensitivity: "base" })
    );
  }

  function renderPanelSelect() {
    const select = document.getElementById("install-panel-select");
    const db = sortedByName(window.AppState.get().panelsDatabase || []);
    select.innerHTML = "";
    db.forEach((p) => {
      const opt = document.createElement("option");
      opt.value = p.id;
      opt.textContent = p.brand + " " + p.model + " — " + p.powerWc + " Wc";
      select.appendChild(opt);
    });
    const profile = getActiveProfile();
    if (!profile) return;
    if (profile.panels.selectedModelId && db.some((p) => p.id === profile.panels.selectedModelId)) {
      select.value = profile.panels.selectedModelId;
    } else if (db.length > 0) {
      setProfileField("panels", "selectedModelId", db[0].id, false);
      select.value = db[0].id;
    }
    window.bindOnce(select, "change", function () {
      setProfileField("panels", "selectedModelId", select.value, true);
    });
  }

  function renderMaskSelect() {
    const select = document.getElementById("install-panel-mask");
    const profiles = window.AppState.get().location.horizonMaskProfiles || [];
    select.innerHTML = '<option value="">Aucun (pas de masquage)</option>';
    profiles.forEach((p) => {
      const opt = document.createElement("option");
      opt.value = p.id;
      opt.textContent = p.name;
      select.appendChild(opt);
    });
    const profile = getActiveProfile();
    if (!profile) return;
    select.value = profile.panels.horizonMaskProfileId || "";
    window.bindOnce(select, "change", function () {
      setProfileField("panels", "horizonMaskProfileId", select.value || null, false);
    });
  }

  function renderInverterSelect() {
    const select = document.getElementById("install-inverter-select");
    const db = sortedByName(window.AppState.get().invertersDatabase || []);
    select.innerHTML = '<option value="">Aucun</option>';
    db.forEach((inv) => {
      const opt = document.createElement("option");
      opt.value = inv.id;
      opt.textContent = inv.brand + " " + inv.model + " — " + inv.ratedPowerW + " W";
      select.appendChild(opt);
    });
    const profile = getActiveProfile();
    if (!profile) return;
    select.value = profile.inverter.selectedModelId || "";
    window.bindOnce(select, "change", function () {
      setProfileField("inverter", "selectedModelId", select.value || null, true);
    });
  }

  function renderBatterySelect() {
    const select = document.getElementById("install-battery-select");
    const db = sortedByName(window.AppState.get().batteriesDatabase || []);
    select.innerHTML = '<option value="">Aucune</option>';
    db.forEach((b) => {
      const opt = document.createElement("option");
      opt.value = b.id;
      opt.textContent = b.brand + " " + b.model + " — " + b.capacityKwh + " kWh";
      select.appendChild(opt);
    });
    const profile = getActiveProfile();
    if (!profile) return;
    select.value = profile.battery.selectedModelId || "";
    window.bindOnce(select, "change", function () {
      setProfileField("battery", "selectedModelId", select.value || null, true);
    });
  }

  // ------------------------------------------------------------------
  // Champs simples (nombre, orientation, inclinaison, dégradation, stratégies)
  // ------------------------------------------------------------------
  function setProfileField(group, field, value, doRecomputePrice) {
    const st = window.AppState.get();
    const profile = st.installationProfiles.find((p) => p.id === st.activeInstallationProfileId);
    if (!profile) return;
    if (group) profile[group][field] = value;
    else profile[field] = value;
    window.AppState.set("installationProfiles", st.installationProfiles);
    if (doRecomputePrice) recomputePrice();
  }

  function bindFields() {
    const profile = getActiveProfile();
    if (!profile) return;
    bindNumberField("install-panel-count", profile.panels.count, (v) => setProfileField("panels", "count", v, true));
    bindNumberField("install-panel-degradation", profile.panels.degradationPerYear, (v) => setProfileField("panels", "degradationPerYear", v, false));
    bindNumberField("install-panel-orientation", profile.panels.orientation, (v) => setProfileField("panels", "orientation", v, false));
    bindNumberField("install-panel-tilt", profile.panels.tilt, (v) => setProfileField("panels", "tilt", v, false));
  }

  function bindNumberField(id, initialValue, onChange) {
    const el = document.getElementById(id);
    el.value = initialValue;
    window.bindOnce(el, "change", function () {
      onChange(parseFloat(el.value) || 0);
    });
  }

  function bindStrategyFields() {
    const profile = getActiveProfile();
    if (!profile) return;

    const chargeMode = document.getElementById("install-charge-mode");
    chargeMode.value = profile.chargeStrategy.mode;
    window.bindOnce(chargeMode, "change", function () {
      setProfileField("chargeStrategy", "mode", chargeMode.value, false);
    });

    const chargeGrid = document.getElementById("install-charge-grid");
    chargeGrid.value = profile.chargeStrategy.gridChargeMode;
    window.bindOnce(chargeGrid, "change", function () {
      setProfileField("chargeStrategy", "gridChargeMode", chargeGrid.value, false);
    });

    bindNumberField("install-charge-max-soc", profile.chargeStrategy.maxSocPct, (v) => setProfileField("chargeStrategy", "maxSocPct", v, false));

    const dischargeMode = document.getElementById("install-discharge-mode");
    dischargeMode.value = profile.dischargeStrategy.mode;
    window.bindOnce(dischargeMode, "change", function () {
      setProfileField("dischargeStrategy", "mode", dischargeMode.value, false);
    });

    bindNumberField("install-discharge-start", profile.dischargeStrategy.scheduleStartHour, (v) => setProfileField("dischargeStrategy", "scheduleStartHour", v, false));
    bindNumberField("install-discharge-end", profile.dischargeStrategy.scheduleEndHour, (v) => setProfileField("dischargeStrategy", "scheduleEndHour", v, false));
    bindNumberField("install-discharge-min-soc", profile.dischargeStrategy.minSocPct, (v) => setProfileField("dischargeStrategy", "minSocPct", v, false));

    const sellMode = document.getElementById("install-sell-mode");
    sellMode.value = profile.sellMode;
    window.bindOnce(sellMode, "change", function () {
      setProfileField(null, "sellMode", sellMode.value, false);
    });
  }

  // ------------------------------------------------------------------
  // Coût fixe (lignes libellé + prix, éventuellement négatif)
  // ------------------------------------------------------------------
  function escapeAttr(str) {
    return String(str).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
  }

  function renderFixedCostTable() {
    const tbody = document.getElementById("install-fixedcost-table-body");
    tbody.innerHTML = "";
    const profile = getActiveProfile();
    if (!profile) return;

    (profile.fixedCosts || []).forEach((line, index) => {
      const tr = document.createElement("tr");
      tr.innerHTML =
        '<td><input type="text" data-idx="' + index + '" data-field="label" value="' +
        escapeAttr(line.label) + '"></td>' +
        '<td><input type="number" step="1" data-idx="' + index + '" data-field="priceEur" value="' + line.priceEur + '"></td>' +
        '<td><button class="btn btn--sm btn--ghost" data-remove="' + index + '">✕</button></td>';
      tbody.appendChild(tr);
    });

    tbody.querySelectorAll("input").forEach((input) => {
      input.addEventListener("change", function () {
        const idx = parseInt(input.dataset.idx, 10);
        const field = input.dataset.field;
        const st = window.AppState.get();
        const p = st.installationProfiles.find((x) => x.id === st.activeInstallationProfileId);
        p.fixedCosts[idx][field] = field === "priceEur" ? (parseFloat(input.value) || 0) : input.value;
        window.AppState.set("installationProfiles", st.installationProfiles);
        recomputePrice();
      });
    });

    tbody.querySelectorAll("[data-remove]").forEach((btn) => {
      btn.addEventListener("click", function () {
        const idx = parseInt(btn.dataset.remove, 10);
        const st = window.AppState.get();
        const p = st.installationProfiles.find((x) => x.id === st.activeInstallationProfileId);
        p.fixedCosts.splice(idx, 1);
        window.AppState.set("installationProfiles", st.installationProfiles);
        renderFixedCostTable();
        recomputePrice();
      });
    });
  }

  function bindFixedCostAdd() {
    window.bindOnce(document.getElementById("install-fixedcost-add"), "click", function () {
      const st = window.AppState.get();
      const p = st.installationProfiles.find((x) => x.id === st.activeInstallationProfileId);
      if (!p) return;
      if (!p.fixedCosts) p.fixedCosts = [];
      p.fixedCosts.push({ id: "cost-" + Date.now().toString(36), label: "Pose et câblage", priceEur: 0 });
      window.AppState.set("installationProfiles", st.installationProfiles);
      renderFixedCostTable();
      recomputePrice();
    });
  }

  // ------------------------------------------------------------------
  // Prix de l'installation (calculé dynamiquement)
  // ------------------------------------------------------------------
  function recomputePrice() {
    const profile = getActiveProfile();
    if (!profile) return;
    const s = window.AppState.get();

    const panel = (s.panelsDatabase || []).find((p) => p.id === profile.panels.selectedModelId);
    const panelPrice = panel ? panel.priceEur * profile.panels.count : 0;

    const inverter = (s.invertersDatabase || []).find((i) => i.id === profile.inverter.selectedModelId);
    const inverterPrice = inverter ? inverter.priceEur : 0;

    // Une seule batterie par installation, donc pas de multiplicateur.
    const battery = (s.batteriesDatabase || []).find((b) => b.id === profile.battery.selectedModelId);
    const batteryPrice = battery ? battery.priceEur : 0;

    const otherPrice = (profile.fixedCosts || []).reduce((sum, line) => sum + (line.priceEur || 0), 0);

    const total = panelPrice + inverterPrice + batteryPrice + otherPrice;

    document.getElementById("stat-install-price-panels").textContent = panelPrice.toFixed(0);
    document.getElementById("stat-install-price-inverter").textContent = inverterPrice.toFixed(0);
    document.getElementById("stat-install-price-battery").textContent = batteryPrice.toFixed(0);
    document.getElementById("stat-install-price-other").textContent = otherPrice.toFixed(0);
    document.getElementById("stat-install-price-total").textContent = total.toFixed(0);
  }

  // ------------------------------------------------------------------
  // Rafraîchissement croisé (bases éditées dans Matériel/Localisation)
  // ------------------------------------------------------------------
  let dbListenerBound = false;
  function bindDatabaseChangeListener() {
    if (dbListenerBound) return;
    dbListenerBound = true;
    window.AppState.onChange(function (path) {
      if (
        path === "panelsDatabase" ||
        path === "invertersDatabase" ||
        path === "batteriesDatabase" ||
        path === "location"
      ) {
        renderPanelSelect();
        renderMaskSelect();
        renderInverterSelect();
        renderBatterySelect();
        recomputePrice();
      }
    });
  }

  return { init };
})();
