/**
 * tab-panels.js
 * Onglet 2 — Panneaux solaires.
 *
 * Responsabilités :
 *  - sélection d'un modèle dans PanelsDB, nombre, orientation, inclinaison
 *  - choix du profil d'ombre (parmi ceux définis en onglet Localisation)
 *  - courbes de puissance théorique horaire aux solstices/équinoxe
 *  - estimation de production mensuelle réaliste via transposition PVGIS
 *  - courbe de dégradation dans le temps
 *
 * Les calculs eux-mêmes vivent dans js/pv-production.js (logique pure,
 * réutilisable) — ce fichier ne fait que l'interface avec le DOM et l'état.
 */
window.TabPanels = (function () {
  "use strict";

  let powerChart = null;
  let monthlyChart = null;
  let degradationChart = null;

  function init() {
    renderPanelSelect();
    renderPanelDbTable();
    bindPanelDbAddRow();
    bindFields();
    renderMaskProfileSelect();
    recomputeAll();
  }

  // ------------------------------------------------------------------
  // Champs de base (modèle, nombre, orientation, inclinaison, dégradation)
  // ------------------------------------------------------------------
  function getPanelsDatabase() {
    return window.AppState.get().panelsDatabase || [];
  }

  function renderPanelSelect() {
    const select = document.getElementById("panel-model-select");
    select.innerHTML = "";
    const db = getPanelsDatabase();
    db.forEach((p) => {
      const opt = document.createElement("option");
      opt.value = p.id;
      opt.textContent = p.brand + " " + p.model + " — " + p.powerWc + " Wc";
      select.appendChild(opt);
    });

    const s = window.AppState.get().panels;
    if (s.selectedModelId && db.some((p) => p.id === s.selectedModelId)) {
      select.value = s.selectedModelId;
    } else if (db.length > 0) {
      // aucun modèle choisi (ou modèle supprimé de la base) : on prend
      // le premier par défaut, pour que les calculs aient tout de
      // suite quelque chose à montrer
      const st = window.AppState.get();
      st.panels.selectedModelId = db[0].id;
      window.AppState.set("panels", st.panels);
      select.value = st.panels.selectedModelId;
    }

    window.bindOnce(select, "change", function () {
      const st = window.AppState.get();
      st.panels.selectedModelId = select.value;
      window.AppState.set("panels", st.panels);
      recomputeAll();
    });
  }

  function bindFields() {
    const s = window.AppState.get().panels;
    const countEl = document.getElementById("panel-count");
    const orientationEl = document.getElementById("panel-orientation");
    const tiltEl = document.getElementById("panel-tilt");
    const degradationEl = document.getElementById("panel-degradation");

    countEl.value = s.count;
    orientationEl.value = s.orientation;
    tiltEl.value = s.tilt;
    degradationEl.value = s.degradationPerYear;

    [
      [countEl, "count"],
      [orientationEl, "orientation"],
      [tiltEl, "tilt"],
      [degradationEl, "degradationPerYear"],
    ].forEach(([el, field]) => {
      window.bindOnce(el, "change", function () {
        const st = window.AppState.get();
        st.panels[field] = parseFloat(el.value);
        window.AppState.set("panels", st.panels);
        recomputeAll();
      });
    });
  }

  function renderPanelDbTable() {
    const tbody = document.getElementById("panel-db-table-body");
    tbody.innerHTML = "";
    const db = getPanelsDatabase();

    db.forEach((p, index) => {
      const surfaceM2 = p.widthM * p.heightM;
      const efficiencyPct = surfaceM2 > 0 ? (p.powerWc / (surfaceM2 * 1000)) * 100 : 0;
      const tr = document.createElement("tr");
      tr.innerHTML =
        field(index, "brand", "text", p.brand) +
        field(index, "model", "text", p.model) +
        field(index, "widthM", "number", p.widthM, "0.01") +
        field(index, "heightM", "number", p.heightM, "0.01") +
        field(index, "powerWc", "number", p.powerWc, "1") +
        '<td style="color:var(--text-faint);">' + efficiencyPct.toFixed(1) + " %</td>" +
        '<td style="color:var(--text-faint);">' + surfaceM2.toFixed(2) + " m²</td>" +
        field(index, "priceEur", "number", p.priceEur, "1") +
        '<td><button class="btn btn--sm btn--ghost" data-remove-panel="' + index + '">✕</button></td>';
      tbody.appendChild(tr);
    });

    function field(index, key, type, value, step) {
      return (
        '<td><input type="' + type + '"' +
        (step ? ' step="' + step + '"' : "") +
        ' data-idx="' + index + '" data-field="' + key + '"' +
        ' value="' + String(value).replace(/"/g, "&quot;") + '"></td>'
      );
    }

    tbody.querySelectorAll("input").forEach((input) => {
      input.addEventListener("change", function () {
        const idx = parseInt(input.dataset.idx, 10);
        const key = input.dataset.field;
        const isNumeric = input.type === "number";
        const st = window.AppState.get();
        st.panelsDatabase[idx][key] = isNumeric ? parseFloat(input.value) || 0 : input.value;
        window.AppState.set("panelsDatabase", st.panelsDatabase);
        renderPanelDbTable(); // pour rafraîchir la surface calculée
        renderPanelSelect(); // le libellé du menu peut avoir changé
        recomputeAll();
      });
    });

    tbody.querySelectorAll("[data-remove-panel]").forEach((btn) => {
      btn.addEventListener("click", function () {
        const idx = parseInt(btn.dataset.removePanel, 10);
        const st = window.AppState.get();
        if (st.panelsDatabase.length <= 1) {
          alert("Impossible de supprimer le dernier panneau de la base.");
          return;
        }
        st.panelsDatabase.splice(idx, 1);
        window.AppState.set("panelsDatabase", st.panelsDatabase);
        renderPanelDbTable();
        renderPanelSelect();
        recomputeAll();
      });
    });
  }

  function bindPanelDbAddRow() {
    window.bindOnce(document.getElementById("panel-db-add-row"), "click", function () {
      const st = window.AppState.get();
      st.panelsDatabase.push({
        id: "panel-" + Date.now().toString(36),
        brand: "Nouveau",
        model: "Modèle",
        widthM: 1.13,
        heightM: 2.28,
        powerWc: 400,
        priceEur: 200,
      });
      window.AppState.set("panelsDatabase", st.panelsDatabase);
      renderPanelDbTable();
      renderPanelSelect();
    });
  }

  // ------------------------------------------------------------------
  // Profil d'ombre applicable (référence croisée vers l'onglet Localisation)
  // ------------------------------------------------------------------
  function renderMaskProfileSelect() {
    const select = document.getElementById("panel-mask-profile");
    const loc = window.AppState.get().location;
    select.innerHTML = "";

    const noneOpt = document.createElement("option");
    noneOpt.value = "";
    noneOpt.textContent = "Aucun (pas de masquage)";
    select.appendChild(noneOpt);

    loc.horizonMaskProfiles.forEach((p) => {
      const opt = document.createElement("option");
      opt.value = p.id;
      opt.textContent = p.name;
      select.appendChild(opt);
    });

    const s = window.AppState.get().panels;
    select.value = s.horizonMaskProfileId || "";

    window.bindOnce(select, "change", function () {
      const st = window.AppState.get();
      st.panels.horizonMaskProfileId = select.value || null;
      window.AppState.set("panels", st.panels);
      recomputeAll();
    });
  }

  function getSelectedMask() {
    const loc = window.AppState.get().location;
    const panels = window.AppState.get().panels;
    if (!panels.horizonMaskProfileId) return [];
    const profile = loc.horizonMaskProfiles.find((p) => p.id === panels.horizonMaskProfileId);
    return profile ? profile.mask : [];
  }

  // ------------------------------------------------------------------
  // Recalcul global (appelé à chaque changement de champ pertinent)
  // ------------------------------------------------------------------
  function recomputeAll() {
    const s = window.AppState.get();
    const loc = s.location;
    const panelState = s.panels;

    if (loc.lat === null || loc.lng === null) {
      return; // pas de localisation définie, rien à calculer
    }

    const panel = getPanelsDatabase().find((p) => p.id === panelState.selectedModelId);
    if (!panel) return;

    const ratedTotalWc = panel.powerWc * panelState.count;
    const mask = getSelectedMask();

    renderPowerChart(loc, panelState, ratedTotalWc, mask);
    const annualProductionKwh = renderMonthlyProduction(loc, panelState, ratedTotalWc, mask);
    renderDegradationChart(panelState, annualProductionKwh);
  }

  // ------------------------------------------------------------------
  // Courbes de puissance horaire théorique (solstices + équinoxe)
  // ------------------------------------------------------------------
  function renderPowerChart(loc, panelState, ratedTotalWc, mask) {
    const G = window.SolarGeometry;
    const PV = window.PvProduction;

    // Heure réelle (affichage) plutôt qu'heure solaire : en France,
    // l'heure d'été (UTC+2) est en vigueur à la fois au solstice d'été
    // et à l'équinoxe (le changement d'heure a lieu ~1 semaine avant
    // l'équinoxe de printemps et ~1 mois après celui d'automne — on
    // simplifie donc en traitant les deux équinoxes comme "heure
    // d'été"). Seul le solstice d'hiver reste en heure d'hiver (UTC+1).
    // Ce décalage ne change QUE l'étiquette d'heure affichée — la
    // physique et les totaux d'énergie du jour restent identiques.
    const tzEte = 2;
    const tzEquinoxe = 2;
    const tzHiver = 1;

    const resultEte = PV.dayPowerCurve(
      loc.lat, loc.lng, tzEte, G.REFERENCE_DAYS.solsticeEte,
      ratedTotalWc, panelState.tilt, panelState.orientation, mask, 10
    );
    const resultHiver = PV.dayPowerCurve(
      loc.lat, loc.lng, tzHiver, G.REFERENCE_DAYS.solsticeHiver,
      ratedTotalWc, panelState.tilt, panelState.orientation, mask, 10
    );
    const resultEquinoxe = PV.dayPowerCurve(
      loc.lat, loc.lng, tzEquinoxe, G.REFERENCE_DAYS.equinoxe,
      ratedTotalWc, panelState.tilt, panelState.orientation, mask, 10
    );

    document.getElementById("stat-energy-ete").textContent = resultEte.energyKwh.toFixed(2);
    document.getElementById("stat-energy-hiver").textContent = resultHiver.energyKwh.toFixed(2);
    document.getElementById("stat-energy-equinoxe").textContent = resultEquinoxe.energyKwh.toFixed(2);

    const datasets = [
      {
        label: "Solstice d'été",
        data: resultEte.points.map((p) => ({ x: p.hour, y: p.powerW })),
        borderColor: "#f5a623",
        backgroundColor: "rgba(245,166,35,0.12)",
        fill: true,
        tension: 0.2,
        pointRadius: 0,
      },
      {
        label: "Solstice d'hiver",
        data: resultHiver.points.map((p) => ({ x: p.hour, y: p.powerW })),
        borderColor: "#3ec9a7",
        backgroundColor: "rgba(62,201,167,0.12)",
        fill: true,
        tension: 0.2,
        pointRadius: 0,
      },
      {
        label: "Équinoxe",
        data: resultEquinoxe.points.map((p) => ({ x: p.hour, y: p.powerW })),
        borderColor: "#9b8cff",
        backgroundColor: "rgba(155,140,255,0.08)",
        borderDash: [4, 3],
        fill: false,
        tension: 0.2,
        pointRadius: 0,
      },
    ];

    // Note : pas de superposition "heures masquées" ici (contrairement
    // à l'onglet Localisation) — la courbe elle-même chute déjà pour
    // refléter le masquage, l'ajouter en plus surchargeait le
    // graphique sans apporter d'information supplémentaire.

    const ctx = document.getElementById("chart-panel-power").getContext("2d");
    if (powerChart) powerChart.destroy();

    powerChart = new Chart(ctx, {
      type: "line",
      data: { datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "nearest", axis: "x", intersect: false },
        scales: {
          x: {
            type: "linear",
            min: 0,
            max: 24,
            title: { display: true, text: "Heure locale", color: "#9a9ea8" },
            ticks: { color: "#9a9ea8", stepSize: 2 },
            grid: { color: "#23272f" },
          },
          y: {
            min: 0,
            title: { display: true, text: "Puissance (W)", color: "#9a9ea8" },
            ticks: { color: "#9a9ea8" },
            grid: { color: "#23272f" },
          },
        },
        plugins: {
          legend: { labels: { color: "#e9e7e0" } },
          tooltip: {
            callbacks: {
              title: (items) => {
                const h = items[0].parsed.x;
                const hh = Math.floor(h);
                const mm = Math.round((h - hh) * 60);
                return String(hh).padStart(2, "0") + "h" + String(mm).padStart(2, "0");
              },
              label: (item) => item.dataset.label + " : " + Math.round(item.parsed.y) + " W",
            },
          },
        },
      },
    });
  }

  // ------------------------------------------------------------------
  // Production mensuelle réaliste (transposition PVGIS)
  // ------------------------------------------------------------------
  function renderMonthlyProduction(loc, panelState, ratedTotalWc, mask) {
    const hint = document.getElementById("panel-monthly-hint");
    const chartWrap = document.getElementById("panel-monthly-chart-wrap");
    const totalWrap = document.getElementById("panel-monthly-total-wrap");

    if (!loc.pvgisCache) {
      hint.textContent = "Récupérez d'abord les données PVGIS dans l'onglet Localisation pour voir cette estimation.";
      hint.style.display = "block";
      chartWrap.style.display = "none";
      totalWrap.style.display = "none";
      return null;
    }

    const PV = window.PvProduction;
    const months = PV.monthlyProductionEstimate(
      loc.lat, loc.lng, loc.timezoneOffset,
      ratedTotalWc, panelState.tilt, panelState.orientation, mask, loc.pvgisCache
    );

    if (!months) {
      hint.textContent = "Les données PVGIS en cache ne sont pas dans un format exploitable (relancez la récupération dans l'onglet Localisation).";
      hint.style.display = "block";
      chartWrap.style.display = "none";
      totalWrap.style.display = "none";
      return null;
    }

    hint.style.display = "none";
    chartWrap.style.display = "block";
    totalWrap.style.display = "flex";

    const monthLabels = ["Jan", "Fév", "Mar", "Avr", "Mai", "Juin", "Juil", "Août", "Sep", "Oct", "Nov", "Déc"];
    const totalKwh = months.reduce((sum, m) => sum + m.productionKwh, 0);
    document.getElementById("stat-annual-production").textContent = totalKwh.toFixed(0);

    if (months.some((m) => m.kdIsDefault)) {
      hint.style.display = "block";
      hint.textContent =
        "Estimation basée sur une valeur par défaut pour la part de rayonnement diffus (le cache PVGIS date d'avant cette amélioration) — relancez la récupération PVGIS dans l'onglet Localisation pour affiner.";
    }

    const ctx = document.getElementById("chart-panel-monthly").getContext("2d");
    if (monthlyChart) monthlyChart.destroy();

    monthlyChart = new Chart(ctx, {
      type: "bar",
      data: {
        labels: monthLabels,
        datasets: [
          {
            label: "Production estimée (kWh/mois)",
            data: months.map((m) => m.productionKwh),
            backgroundColor: "rgba(245,166,35,0.55)",
            borderRadius: 3,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: { ticks: { color: "#9a9ea8" }, grid: { display: false } },
          y: {
            title: { display: true, text: "kWh / mois", color: "#9a9ea8" },
            ticks: { color: "#9a9ea8" },
            grid: { color: "#23272f" },
          },
        },
        plugins: {
          legend: { display: false },
        },
      },
    });

    return totalKwh;
  }

  // ------------------------------------------------------------------
  // Dégradation dans le temps
  // ------------------------------------------------------------------
  function renderDegradationChart(panelState, annualProductionKwh) {
    const years = [];
    for (let y = 0; y <= 25; y++) years.push(y);
    const factors = years.map((y) => Math.pow(1 - panelState.degradationPerYear / 100, y));

    const hasAnnualBaseline = typeof annualProductionKwh === "number";
    const data = hasAnnualBaseline
      ? factors.map((f) => annualProductionKwh * f)
      : factors.map((f) => f * 100); // repli en % si pas de données PVGIS disponibles

    const ctx = document.getElementById("chart-panel-degradation").getContext("2d");
    if (degradationChart) degradationChart.destroy();

    degradationChart = new Chart(ctx, {
      type: "line",
      data: {
        labels: years,
        datasets: [
          {
            label: hasAnnualBaseline ? "Production annuelle estimée (kWh)" : "Rendement restant (%)",
            data: data,
            borderColor: "#e0575b",
            backgroundColor: "rgba(224,87,91,0.12)",
            fill: true,
            tension: 0.15,
            pointRadius: 0,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: {
            title: { display: true, text: "Années", color: "#9a9ea8" },
            ticks: { color: "#9a9ea8" },
            grid: { color: "#23272f" },
          },
          y: {
            min: 0,
            max: hasAnnualBaseline ? undefined : 100,
            title: {
              display: true,
              text: hasAnnualBaseline ? "kWh / an" : "% du rendement initial",
              color: "#9a9ea8",
            },
            ticks: { color: "#9a9ea8" },
            grid: { color: "#23272f" },
          },
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (item) =>
                hasAnnualBaseline
                  ? Math.round(item.parsed.y) + " kWh/an (" + (factors[item.dataIndex] * 100).toFixed(0) + "% du neuf)"
                  : item.parsed.y.toFixed(0) + "%",
            },
          },
        },
      },
    });
  }

  return { init };
})();