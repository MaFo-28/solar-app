/**
 * tab-simulation.js
 * Onglet 4 — Simulation.
 *
 * Config matériel de l'installation (référence les bases éditées dans
 * l'onglet Matériel), courbes de production (théorique horaire,
 * mensuelle réaliste PVGIS, dégradation), stratégies de charge/
 * décharge/vente, validation de cohérence, puis simulation pas-à-pas
 * (js/battery-simulation.js) pour chaque profil de consommation
 * choisi, aux 3 dates de référence (été/hiver/équinoxe).
 */
window.TabSimulation = (function () {
  "use strict";

  /** Tri alphabétique marque puis modèle, insensible à la casse. */
  function sortedByName(list) {
    return list.slice().sort((a, b) =>
      (a.brand + " " + a.model).localeCompare(b.brand + " " + b.model, "fr", { sensitivity: "base" })
    );
  }

  const charts = {}; // clé "profileId-saison" (résultats) -> instance Chart.js
  let pendingCharts = [];

  // graphiques de la section Installation (un seul jeu, pas par profil)
  let powerChart = null;
  let monthlyChart = null;
  let degradationChart = null;

  function init() {
    renderPanelSelect();
    renderMaskSelect();
    renderInverterSelect();
    renderBatterySelect();
    renderConsumptionProfileSelects();
    bindFields();
    bindStrategyFields();
    recompute();
    bindDatabaseChangeListener();
  }

  /**
   * Se réabonne aux changements des bases de données/profils édités
   * dans d'autres onglets (Matériel, Localisation, Consommation) :
   * sans ça, cet onglet resterait figé sur les données du moment de
   * son premier affichage jusqu'à un rechargement de la page.
   */
  let dbListenerBound = false;
  function bindDatabaseChangeListener() {
    if (dbListenerBound) return;
    dbListenerBound = true;
    window.AppState.onChange(function (path) {
      if (
        path === "panelsDatabase" ||
        path === "invertersDatabase" ||
        path === "batteriesDatabase" ||
        path === "location" ||
        path === "consumption"
      ) {
        renderPanelSelect();
        renderMaskSelect();
        renderInverterSelect();
        renderBatterySelect();
        renderConsumptionProfileSelects();
        recompute();
      }
    });
  }

  // ------------------------------------------------------------------
  // Sélecteurs d'équipement (base éditable, "Aucun" pour onduleur/batterie)
  // ------------------------------------------------------------------
  function renderPanelSelect() {
    const select = document.getElementById("strategy-panel-select");
    const db = sortedByName(window.AppState.get().panelsDatabase || []);
    select.innerHTML = "";
    db.forEach((p) => {
      const opt = document.createElement("option");
      opt.value = p.id;
      opt.textContent = p.brand + " " + p.model + " — " + p.powerWc + " Wc";
      select.appendChild(opt);
    });
    const s = window.AppState.get().strategy;
    if (s.panels.selectedModelId && db.some((p) => p.id === s.panels.selectedModelId)) {
      select.value = s.panels.selectedModelId;
    } else if (db.length > 0) {
      setStrategyField("panels", "selectedModelId", db[0].id, false);
      select.value = db[0].id;
    }
    window.bindOnce(select, "change", function () {
      setStrategyField("panels", "selectedModelId", select.value, true);
    });
  }

  function renderMaskSelect() {
    const select = document.getElementById("strategy-panel-mask");
    const profiles = window.AppState.get().location.horizonMaskProfiles || [];
    select.innerHTML = '<option value="">Aucun (pas de masquage)</option>';
    profiles.forEach((p) => {
      const opt = document.createElement("option");
      opt.value = p.id;
      opt.textContent = p.name;
      select.appendChild(opt);
    });
    const s = window.AppState.get().strategy;
    select.value = s.panels.horizonMaskProfileId || "";
    window.bindOnce(select, "change", function () {
      setStrategyField("panels", "horizonMaskProfileId", select.value || null, true);
    });
  }

  function renderInverterSelect() {
    const select = document.getElementById("strategy-inverter-select");
    const db = sortedByName(window.AppState.get().invertersDatabase || []);
    select.innerHTML = '<option value="">Aucun</option>';
    db.forEach((inv) => {
      const opt = document.createElement("option");
      opt.value = inv.id;
      opt.textContent = inv.brand + " " + inv.model + " — " + inv.ratedPowerW + " W";
      select.appendChild(opt);
    });
    const s = window.AppState.get().strategy;
    select.value = s.inverter.selectedModelId || "";
    window.bindOnce(select, "change", function () {
      setStrategyField("inverter", "selectedModelId", select.value || null, true);
    });
  }

  function renderBatterySelect() {
    const select = document.getElementById("strategy-battery-select");
    const db = sortedByName(window.AppState.get().batteriesDatabase || []);
    select.innerHTML = '<option value="">Aucune</option>';
    db.forEach((b) => {
      const opt = document.createElement("option");
      opt.value = b.id;
      opt.textContent = b.brand + " " + b.model + " — " + b.capacityKwh + " kWh";
      select.appendChild(opt);
    });
    const s = window.AppState.get().strategy;
    select.value = s.battery.selectedModelId || "";
    window.bindOnce(select, "change", function () {
      setStrategyField("battery", "selectedModelId", select.value || null, true);
    });
  }

  function renderConsumptionProfileSelects() {
    const profiles = window.AppState.get().consumption.profiles || [];
    const select = document.getElementById("strategy-consumption-profile-1");
    select.innerHTML = "";
    profiles.forEach((p) => {
      const opt = document.createElement("option");
      opt.value = p.id;
      opt.textContent = p.name;
      select.appendChild(opt);
    });
    const s = window.AppState.get().strategy;
    const current = s.consumptionProfileIds[0];
    if (current && profiles.some((p) => p.id === current)) {
      select.value = current;
    } else if (profiles.length > 0) {
      select.value = profiles[0].id;
      const st = window.AppState.get();
      st.strategy.consumptionProfileIds = [profiles[0].id];
      window.AppState.set("strategy", st.strategy);
    }
    window.bindOnce(select, "change", function () {
      const st = window.AppState.get();
      st.strategy.consumptionProfileIds = select.value ? [select.value] : [];
      window.AppState.set("strategy", st.strategy);
      recompute();
    });
  }

  // ------------------------------------------------------------------
  // Champs simples (nombre, orientation, inclinaison, stratégies)
  // ------------------------------------------------------------------
  function setStrategyField(group, field, value, doRecompute) {
    const st = window.AppState.get();
    st.strategy[group][field] = value;
    window.AppState.set("strategy", st.strategy);
    if (doRecompute) recompute();
  }

  function bindFields() {
    const s = window.AppState.get().strategy;
    bindNumberField("strategy-panel-count", s.panels.count, (v) => setStrategyField("panels", "count", v, true));
    bindNumberField("strategy-panel-orientation", s.panels.orientation, (v) => setStrategyField("panels", "orientation", v, true));
    bindNumberField("strategy-panel-tilt", s.panels.tilt, (v) => setStrategyField("panels", "tilt", v, true));
    bindNumberField("strategy-panel-degradation", s.panels.degradationPerYear, (v) => setStrategyField("panels", "degradationPerYear", v, true));
    bindNumberField("strategy-battery-count", s.battery.count, (v) => setStrategyField("battery", "count", v, true));
  }

  function bindNumberField(id, initialValue, onChange) {
    const el = document.getElementById(id);
    el.value = initialValue;
    window.bindOnce(el, "change", function () {
      onChange(parseFloat(el.value) || 0);
    });
  }

  function bindStrategyFields() {
    const s = window.AppState.get().strategy;

    const chargeMode = document.getElementById("strategy-charge-mode");
    chargeMode.value = s.chargeStrategy.mode;
    window.bindOnce(chargeMode, "change", function () {
      setStrategyField("chargeStrategy", "mode", chargeMode.value, true);
    });

    const chargeGrid = document.getElementById("strategy-charge-grid");
    chargeGrid.value = s.chargeStrategy.gridChargeMode;
    window.bindOnce(chargeGrid, "change", function () {
      setStrategyField("chargeStrategy", "gridChargeMode", chargeGrid.value, true);
    });

    bindNumberField("strategy-charge-max-soc", s.chargeStrategy.maxSocPct, (v) => setStrategyField("chargeStrategy", "maxSocPct", v, true));

    const dischargeMode = document.getElementById("strategy-discharge-mode");
    dischargeMode.value = s.dischargeStrategy.mode;
    window.bindOnce(dischargeMode, "change", function () {
      setStrategyField("dischargeStrategy", "mode", dischargeMode.value, true);
    });

    bindNumberField("strategy-discharge-start", s.dischargeStrategy.scheduleStartHour, (v) => setStrategyField("dischargeStrategy", "scheduleStartHour", v, true));
    bindNumberField("strategy-discharge-end", s.dischargeStrategy.scheduleEndHour, (v) => setStrategyField("dischargeStrategy", "scheduleEndHour", v, true));
    bindNumberField("strategy-discharge-min-soc", s.dischargeStrategy.minSocPct, (v) => setStrategyField("dischargeStrategy", "minSocPct", v, true));
    bindNumberField("strategy-initial-soc", s.dischargeStrategy.initialSocPct, (v) => setStrategyField("dischargeStrategy", "initialSocPct", v, true));

    const sellMode = document.getElementById("strategy-sell-mode");
    sellMode.value = s.sellMode;
    window.bindOnce(sellMode, "change", function () {
      const st = window.AppState.get();
      st.strategy.sellMode = sellMode.value;
      window.AppState.set("strategy", st.strategy);
      recompute();
    });
  }

  // ------------------------------------------------------------------
  // Validation
  // ------------------------------------------------------------------
  function validate(ctx) {
    const errors = [];
    if (!ctx.panel) errors.push("Sélectionnez un modèle de panneau.");
    if (ctx.battery && !ctx.battery.hasSolarInput && !ctx.inverter) {
      errors.push("Cette batterie n'a pas d'entrée solaire directe : un onduleur est nécessaire pour la recharger (et pour utiliser l'électricité produite).");
    }
    if (!ctx.battery && !ctx.inverter) {
      errors.push("Sans batterie et sans onduleur, l'électricité produite n'est pas utilisable.");
    }
    if (ctx.battery && ctx.strategy.chargeStrategy.gridChargeMode !== "off" && !ctx.battery.chargeSchedulable) {
      errors.push('La batterie sélectionnée ne supporte pas le pilotage horaire de charge ("charge déplaçable"), nécessaire pour la recharge réseau en heures creuses.');
    }
    if (ctx.battery && ctx.strategy.dischargeStrategy.mode !== "asap" && !ctx.battery.dischargeSchedulable) {
      errors.push('La batterie sélectionnée ne supporte pas le pilotage horaire de décharge ("décharge déplaçable"), nécessaire pour cette stratégie de décharge.');
    }
    if (!ctx.battery && ctx.strategy.chargeStrategy.gridChargeMode !== "off") {
      errors.push("Aucune batterie sélectionnée : la stratégie de recharge réseau n'a pas d'effet.");
    }
    if (ctx.strategy.chargeStrategy.maxSocPct <= ctx.strategy.dischargeStrategy.minSocPct) {
      errors.push("La limite de charge (%) doit être strictement supérieure à la limite de décharge (%).");
    }
    if (ctx.consumptionProfiles.length === 0) {
      errors.push("Sélectionnez au moins un profil de consommation.");
    }
    if (window.AppState.get().location.lat === null) {
      errors.push("Renseignez d'abord une localisation (onglet Localisation).");
    }
    return errors;
  }

  function renderErrors(errors) {
    const box = document.getElementById("strategy-errors");
    const list = document.getElementById("strategy-errors-list");
    if (errors.length === 0) {
      box.style.display = "none";
      return;
    }
    list.innerHTML = errors.map((e) => "<li>" + e + "</li>").join("");
    box.style.display = "block";
  }

  // ------------------------------------------------------------------
  // Recalcul global
  // ------------------------------------------------------------------
  function buildContext() {
    const s = window.AppState.get();
    const strategy = s.strategy;
    const panel = (s.panelsDatabase || []).find((p) => p.id === strategy.panels.selectedModelId) || null;
    const inverter = (s.invertersDatabase || []).find((i) => i.id === strategy.inverter.selectedModelId) || null;
    const battery = (s.batteriesDatabase || []).find((b) => b.id === strategy.battery.selectedModelId) || null;
    const consumptionProfiles = strategy.consumptionProfileIds
      .filter(Boolean)
      .map((id) => (s.consumption.profiles || []).find((p) => p.id === id))
      .filter(Boolean);
    return { s, strategy, panel, inverter, battery, consumptionProfiles };
  }

  function recompute() {
    const ctx = buildContext();
    renderInstallationCharts(ctx);

    const errors = validate(ctx);
    renderErrors(errors);

    const resultsEl = document.getElementById("strategy-results");
    resultsEl.innerHTML = "";
    if (errors.length > 0 || !ctx.panel) {
      const finalSocDisplay = document.getElementById("strategy-final-soc-display");
      if (finalSocDisplay) finalSocDisplay.value = "—";
      return;
    }

    ctx.consumptionProfiles.forEach((profile) => {
      resultsEl.appendChild(renderProfileResults(ctx, profile));
    });

    flushPendingCharts();
  }

  // ------------------------------------------------------------------
  // Graphiques de la section Installation (production théorique,
  // mensuelle réaliste PVGIS, dégradation) — ne dépendent que du
  // panneau choisi et de la localisation, pas de la config stratégie
  // (charge/décharge/vente) ni des profils de consommation.
  // ------------------------------------------------------------------
  function renderInstallationCharts(ctx) {
    const loc = ctx.s.location;
    if (loc.lat === null || loc.lng === null || !ctx.panel) return;

    const ratedTotalWc = ctx.panel.powerWc * ctx.strategy.panels.count;
    const mask = ctx.strategy.panels.horizonMaskProfileId
      ? ((loc.horizonMaskProfiles.find((p) => p.id === ctx.strategy.panels.horizonMaskProfileId) || {}).mask || [])
      : [];

    renderPowerChart(loc, ctx.strategy.panels, ratedTotalWc, mask);
    const annualProductionKwh = renderMonthlyProduction(loc, ctx.strategy.panels, ratedTotalWc, mask);
    renderDegradationChart(ctx.strategy.panels, annualProductionKwh);
  }

  function renderPowerChart(loc, panelsConfig, ratedTotalWc, mask) {
    const G = window.SolarGeometry;
    const PV = window.PvProduction;

    // Heure réelle (affichage) plutôt qu'heure solaire : en France,
    // l'heure d'été (UTC+2) est en vigueur à la fois au solstice d'été
    // et à l'équinoxe (le changement d'heure a lieu ~1 semaine avant
    // l'équinoxe de printemps et ~1 mois après celui d'automne — on
    // simplifie donc en traitant les deux équinoxes comme "heure
    // d'été"). Seul le solstice d'hiver reste en heure d'hiver (UTC+1).
    const tzEte = 2;
    const tzEquinoxe = 2;
    const tzHiver = 1;

    const resultEte = PV.dayPowerCurve(
      loc.lat, loc.lng, tzEte, G.REFERENCE_DAYS.solsticeEte,
      ratedTotalWc, panelsConfig.tilt, panelsConfig.orientation, mask, 10
    );
    const resultHiver = PV.dayPowerCurve(
      loc.lat, loc.lng, tzHiver, G.REFERENCE_DAYS.solsticeHiver,
      ratedTotalWc, panelsConfig.tilt, panelsConfig.orientation, mask, 10
    );
    const resultEquinoxe = PV.dayPowerCurve(
      loc.lat, loc.lng, tzEquinoxe, G.REFERENCE_DAYS.equinoxe,
      ratedTotalWc, panelsConfig.tilt, panelsConfig.orientation, mask, 10
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

    // Note : pas de superposition "heures masquées" — la courbe
    // elle-même chute déjà pour refléter le masquage.

    const ctx2d = document.getElementById("chart-panel-power").getContext("2d");
    if (powerChart) powerChart.destroy();

    powerChart = new Chart(ctx2d, {
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

  function renderMonthlyProduction(loc, panelsConfig, ratedTotalWc, mask) {
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
      ratedTotalWc, panelsConfig.tilt, panelsConfig.orientation, mask, loc.pvgisCache
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

    const monthlyValues = PV.monthlyProductionValueEur(
      loc.lat, loc.lng, loc.timezoneOffset,
      ratedTotalWc, panelsConfig.tilt, panelsConfig.orientation, mask, months, loc.tariffs
    );
    const totalValueEur = monthlyValues.reduce((sum, m) => sum + m.valueEur, 0);
    document.getElementById("stat-annual-value").textContent = totalValueEur.toFixed(0);

    if (months.some((m) => m.kdIsDefault)) {
      hint.style.display = "block";
      hint.textContent =
        "Estimation basée sur une valeur par défaut pour la part de rayonnement diffus (le cache PVGIS date d'avant cette amélioration) — relancez la récupération PVGIS dans l'onglet Localisation pour affiner.";
    }

    const ctx2d = document.getElementById("chart-panel-monthly").getContext("2d");
    if (monthlyChart) monthlyChart.destroy();

    monthlyChart = new Chart(ctx2d, {
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

  function renderDegradationChart(panelsConfig, annualProductionKwh) {
    const years = [];
    for (let y = 0; y <= 25; y++) years.push(y);
    const factors = years.map((y) => Math.pow(1 - panelsConfig.degradationPerYear / 100, y));

    const hasAnnualBaseline = typeof annualProductionKwh === "number";
    const data = hasAnnualBaseline
      ? factors.map((f) => annualProductionKwh * f)
      : factors.map((f) => f * 100); // repli en % si pas de données PVGIS disponibles

    const ctx2d = document.getElementById("chart-panel-degradation").getContext("2d");
    if (degradationChart) degradationChart.destroy();

    degradationChart = new Chart(ctx2d, {
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

  // ------------------------------------------------------------------
  // Résultats par profil : 3 graphiques (été/hiver/équinoxe) + coûts
  // ------------------------------------------------------------------
  const SEASONS = [
    { key: "ete", label: "Été (21 juin)" },
    { key: "equinoxe", label: "Équinoxe" },
    { key: "hiver", label: "Hiver (21 décembre)" },
  ];

  function runSimulationForSeason(ctx, profile, seasonKey) {
    const G = window.SolarGeometry;
    const PV = window.PvProduction;
    const loc = ctx.s.location;
    const doyMap = {
      ete: G.REFERENCE_DAYS.solsticeEte,
      hiver: G.REFERENCE_DAYS.solsticeHiver,
      equinoxe: G.REFERENCE_DAYS.equinoxe,
    };
    const tzMap = { ete: 2, hiver: 1, equinoxe: 2 }; // heure réelle française, cf. onglet Panneaux

    const ratedTotalWc = ctx.panel.powerWc * ctx.strategy.panels.count;
    const mask = ctx.strategy.panels.horizonMaskProfileId
      ? ((loc.horizonMaskProfiles.find((p) => p.id === ctx.strategy.panels.horizonMaskProfileId) || {}).mask || [])
      : [];

    const powerCurve = PV.dayPowerCurve(
      loc.lat, loc.lng, tzMap[seasonKey], doyMap[seasonKey],
      ratedTotalWc, ctx.strategy.panels.tilt, ctx.strategy.panels.orientation, mask, 10
    );

    return window.BatterySimulation.simulateDay({
      stepMinutes: 10,
      productionPoints: powerCurve.points.map((p) => ({ hour: p.hour, powerW: p.powerW })),
      consumptionSegments: profile.segments,
      tariffs: loc.tariffs,
      sellTariffPerKwh: loc.sellTariffPerKwh,
      battery: ctx.battery,
      batteryCount: ctx.strategy.battery.count,
      hasInverter: !!ctx.inverter,
      inverterEfficiencyPct: ctx.inverter ? ctx.inverter.efficiencyPct : 100,
      chargeStrategy: ctx.strategy.chargeStrategy,
      dischargeStrategy: ctx.strategy.dischargeStrategy,
      sellMode: ctx.strategy.sellMode,
      initialSocPct: ctx.strategy.dischargeStrategy.initialSocPct,
    });
  }

  /**
   * Consommation et coût du jour SANS aucune installation (achat 100%
   * au réseau) — sert de référence pour les colonnes "Économie" du
   * tableau de résultats. Même calcul exact par points de rupture que
   * l'onglet Consommation (voir js/consumption-utils.js).
   */
  function computeBaselineConsumption(segments, tariffs) {
    const U = window.ConsumptionUtils;
    const bps = U.getBreakpoints(segments, tariffs);
    let kwh = 0;
    let cost = 0;
    for (let i = 0; i < bps.length - 1; i++) {
      const t0 = bps[i];
      const t1 = bps[i + 1];
      if (t1 <= t0) continue;
      const powerW = U.powerAtHour(segments, t0);
      const tariff = U.tariffForHour(tariffs, t0);
      const intervalKwh = (powerW / 1000) * (t1 - t0);
      kwh += intervalKwh;
      cost += intervalKwh * (tariff ? tariff.pricePerKwh : 0);
    }
    return { kwh, cost };
  }

  function renderProfileResults(ctx, profile) {
    const wrap = document.createElement("div");
    wrap.className = "card";

    const header = document.createElement("div");
    header.className = "card__header";
    header.innerHTML = '<h2 class="card__title">Résultats — ' + escapeHtml(profile.name) + "</h2>";
    wrap.appendChild(header);

    const results = {};
    SEASONS.forEach((season) => {
      results[season.key] = runSimulationForSeason(ctx, profile, season.key);
    });

    // Consommation et coût du jour SANS installation (achat 100% au
    // réseau) — sert de référence pour les colonnes "Économie"
    // ci-dessous. Indépendant de la saison : le profil de consommation
    // est le même chaque jour dans notre modèle.
    const baseline = computeBaselineConsumption(profile.segments, ctx.s.location.tariffs);
    const baselineRow = document.createElement("div");
    baselineRow.className = "stat-row";
    baselineRow.style.marginBottom = "14px";
    baselineRow.innerHTML =
      '<div class="stat"><span class="stat__label">Consommation du jour</span>' +
      '<span class="stat__value">' + baseline.kwh.toFixed(2) + '<span class="stat__unit">kWh</span></span></div>' +
      '<div class="stat"><span class="stat__label">Coût du jour (sans installation)</span>' +
      '<span class="stat__value stat__value--battery">' + baseline.cost.toFixed(2) + '<span class="stat__unit">€</span></span></div>';
    wrap.appendChild(baselineRow);

    // Niveau de charge en fin de journée simulée, par saison (résultat
    // affiché à côté du niveau de début, dans la carte "Stratégie de
    // décharge de la batterie")
    const finalSocDisplay = document.getElementById("strategy-final-soc-display");
    if (finalSocDisplay) {
      if (ctx.battery) {
        const parts = SEASONS.map((season) => {
          const pts = results[season.key].points;
          const finalSoc = pts.length > 0 ? pts[pts.length - 1].socPct : 0;
          return season.label.split(" ")[0] + " : " + finalSoc.toFixed(0) + "%";
        });
        finalSocDisplay.value = parts.join("  ·  ");
      } else {
        finalSocDisplay.value = "—";
      }
    }

    // Tableau de coûts aux 3 dates
    const table = document.createElement("table");
    table.className = "data-table";
    table.style.marginBottom = "18px";
    table.innerHTML =
      "<thead><tr><th></th><th>Import</th><th>Export</th><th>Coût total</th><th>dont HC</th><th>dont HP</th><th>Économie</th><th>Économie</th></tr></thead>" +
      "<tbody>" +
      SEASONS.map((season) => {
        const r = results[season.key];
        const economyKwh = baseline.kwh - r.totalImportKwh;
        const economyEur = baseline.cost - r.costTotal;
        return (
          "<tr><td>" + season.label + "</td>" +
          "<td>" + r.totalImportKwh.toFixed(2) + " kWh</td>" +
          "<td>" + r.totalExportKwh.toFixed(2) + " kWh</td>" +
          "<td>" + r.costTotal.toFixed(2) + " €</td>" +
          "<td>" + r.costHc.toFixed(2) + " €</td>" +
          "<td>" + r.costHp.toFixed(2) + " €</td>" +
          "<td>" + economyKwh.toFixed(2) + " kWh</td>" +
          "<td>" + economyEur.toFixed(2) + " €</td></tr>"
        );
      }).join("") +
      "</tbody>";
    wrap.appendChild(table);

    // 3 graphiques empilés (un par saison)
    SEASONS.forEach((season) => {
      const chartTitle = document.createElement("p");
      chartTitle.className = "field__hint";
      chartTitle.style.marginTop = "14px";
      chartTitle.innerHTML = "<strong style='color:var(--text);'>" + season.label + "</strong>";
      wrap.appendChild(chartTitle);

      const chartWrap = document.createElement("div");
      chartWrap.className = "chart-wrap";
      const canvas = document.createElement("canvas");
      const canvasId = "strategy-chart-" + profile.id + "-" + season.key;
      canvas.id = canvasId;
      chartWrap.appendChild(canvas);
      wrap.appendChild(chartWrap);

      // le canvas doit être dans le DOM avant de pouvoir tracer —
      // reporté juste après l'insertion complète du bloc (flushPendingCharts)
      pendingCharts.push({ canvasId, result: results[season.key] });
    });

    return wrap;
  }

  function flushPendingCharts() {
    pendingCharts.forEach(({ canvasId, result }) => renderResultChart(canvasId, result));
    pendingCharts = [];
  }

  function renderResultChart(canvasId, result) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const ctx2d = canvas.getContext("2d");

    if (charts[canvasId]) charts[canvasId].destroy();

    const battSigned = result.points.map((p) => ({ x: p.hour, y: p.batteryDischargeW - p.batteryChargeW }));
    const gridSigned = result.points.map((p) => ({ x: p.hour, y: p.gridImportW - p.gridExportW }));

    charts[canvasId] = new Chart(ctx2d, {
      type: "line",
      data: {
        datasets: [
          {
            label: "Production solaire (W)",
            data: result.points.map((p) => ({ x: p.hour, y: p.productionW })),
            borderColor: "#f5a623",
            backgroundColor: "rgba(245,166,35,0.12)",
            fill: true,
            pointRadius: 0,
            tension: 0.15,
          },
          {
            label: "Consommation (W)",
            data: result.points.map((p) => ({ x: p.hour, y: p.consumptionW })),
            borderColor: "#3ec9a7",
            backgroundColor: "transparent",
            pointRadius: 0,
            tension: 0.15,
          },
          {
            label: "Batterie (+déch. / -charge, W)",
            data: battSigned,
            borderColor: "#9b8cff",
            backgroundColor: "transparent",
            pointRadius: 0,
            borderDash: [4, 3],
            tension: 0.1,
          },
          {
            label: "Réseau (+achat / -vente, W)",
            data: gridSigned,
            borderColor: "#e0575b",
            backgroundColor: "transparent",
            pointRadius: 0,
            tension: 0.1,
          },
          {
            label: "SoC batterie (%)",
            data: result.points.map((p) => ({ x: p.hour, y: p.socPct })),
            borderColor: "#9a9ea8",
            backgroundColor: "transparent",
            borderDash: [2, 2],
            pointRadius: 0,
            tension: 0.1,
            yAxisID: "y1",
          },
        ],
      },
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
            title: { display: true, text: "Puissance (W)", color: "#9a9ea8" },
            ticks: { color: "#9a9ea8" },
            grid: { color: "#23272f" },
          },
          y1: {
            position: "right",
            min: 0,
            max: 100,
            title: { display: true, text: "SoC (%)", color: "#9a9ea8" },
            ticks: { color: "#9a9ea8" },
            grid: { display: false },
          },
        },
        plugins: {
          legend: { labels: { color: "#e9e7e0", boxWidth: 12, font: { size: 10 } } },
        },
      },
    });
  }

  function escapeHtml(str) {
    return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  return { init };
})();
