/**
 * tab-simulation.js
 * Onglet 5 — Simulation. Bac à sable à 3 journées de référence
 * (été/équinoxe/hiver) pour visualiser le fonctionnement du système :
 * on choisit un profil d'installation (onglet Installation) et un
 * profil de consommation (onglet Consommation), et on obtient la
 * courbe de production théorique puis les résultats pas-à-pas
 * (charge/décharge batterie, import/export réseau, coûts).
 *
 * Ne gère ni le matériel ni les stratégies — ça, c'est l'onglet
 * Installation. Cet onglet ne fait que choisir un profil déjà défini,
 * fixer le niveau de charge de départ de la batterie, et visualiser.
 */
window.TabSimulation = (function () {
  "use strict";

  const charts = {}; // clé = id du canvas (résultats) -> instance Chart.js
  let pendingCharts = [];
  let powerChart = null; // graphique "Production horaire théorique"

  function init() {
    renderInstallSelect();
    renderConsumptionSelect();
    bindInitialSoc();
    recompute();
    bindDatabaseChangeListener();
  }

  // ------------------------------------------------------------------
  // Sélecteurs (profil d'installation, profil de consommation)
  // ------------------------------------------------------------------
  function renderInstallSelect() {
    const select = document.getElementById("simulation-install-select");
    const profiles = window.AppState.get().installationProfiles || [];
    select.innerHTML = "";
    profiles.forEach((p) => {
      const opt = document.createElement("option");
      opt.value = p.id;
      opt.textContent = p.name;
      select.appendChild(opt);
    });
    const current = window.AppState.get().simulationConfig.installationProfileId;
    if (current && profiles.some((p) => p.id === current)) {
      select.value = current;
    } else if (profiles.length > 0) {
      select.value = profiles[0].id;
      setSimulationField("installationProfileId", profiles[0].id, false);
    }
    window.bindOnce(select, "change", function () {
      setSimulationField("installationProfileId", select.value, true);
    });
  }

  function renderConsumptionSelect() {
    const select = document.getElementById("simulation-consumption-select");
    const profiles = window.AppState.get().consumption.profiles || [];
    select.innerHTML = "";
    profiles.forEach((p) => {
      const opt = document.createElement("option");
      opt.value = p.id;
      opt.textContent = p.name;
      select.appendChild(opt);
    });
    const current = window.AppState.get().simulationConfig.consumptionProfileId;
    if (current && profiles.some((p) => p.id === current)) {
      select.value = current;
    } else if (profiles.length > 0) {
      select.value = profiles[0].id;
      setSimulationField("consumptionProfileId", profiles[0].id, false);
    }
    window.bindOnce(select, "change", function () {
      setSimulationField("consumptionProfileId", select.value, true);
    });
  }

  function setSimulationField(field, value, doRecompute) {
    const st = window.AppState.get();
    st.simulationConfig[field] = value;
    window.AppState.set("simulationConfig", st.simulationConfig);
    if (doRecompute) recompute();
  }

  function bindInitialSoc() {
    const el = document.getElementById("simulation-initial-soc");
    el.value = window.AppState.get().simulationConfig.initialSocPct;
    window.bindOnce(el, "change", function () {
      setSimulationField("initialSocPct", parseFloat(el.value) || 0, true);
    });
  }

  /**
   * Se réabonne aux changements faits dans les autres onglets
   * (Installation, Matériel, Localisation, Consommation) : sans ça,
   * cet onglet resterait figé sur les données du moment de son premier
   * affichage jusqu'à un rechargement de la page.
   */
  let dbListenerBound = false;
  function bindDatabaseChangeListener() {
    if (dbListenerBound) return;
    dbListenerBound = true;
    window.AppState.onChange(function (path) {
      if (
        path === "installationProfiles" ||
        path === "panelsDatabase" ||
        path === "invertersDatabase" ||
        path === "batteriesDatabase" ||
        path === "location" ||
        path === "consumption"
      ) {
        renderInstallSelect();
        renderConsumptionSelect();
        recompute();
      }
    });
  }

  // ------------------------------------------------------------------
  // Contexte courant (profil d'installation + matériel + consommation résolus)
  // ------------------------------------------------------------------
  function buildContext() {
    const s = window.AppState.get();
    const sim = s.simulationConfig;
    const installProfile =
      (s.installationProfiles || []).find((p) => p.id === sim.installationProfileId) ||
      (s.installationProfiles || [])[0] ||
      null;
    const panel = installProfile
      ? (s.panelsDatabase || []).find((p) => p.id === installProfile.panels.selectedModelId) || null
      : null;
    const inverter = installProfile
      ? (s.invertersDatabase || []).find((i) => i.id === installProfile.inverter.selectedModelId) || null
      : null;
    const battery = installProfile
      ? (s.batteriesDatabase || []).find((b) => b.id === installProfile.battery.selectedModelId) || null
      : null;
    const consumptionProfile =
      (s.consumption.profiles || []).find((p) => p.id === sim.consumptionProfileId) || null;
    return { s, installProfile, panel, inverter, battery, consumptionProfile };
  }

  // ------------------------------------------------------------------
  // Validation
  // ------------------------------------------------------------------
  function validate(ctx) {
    const errors = [];
    if (!ctx.installProfile) {
      errors.push("Sélectionnez un profil d'installation (onglet Installation).");
      return errors;
    }
    if (!ctx.panel) errors.push("Le profil d'installation choisi n'a pas de modèle de panneau sélectionné.");
    if (ctx.battery && !ctx.battery.hasSolarInput && !ctx.inverter) {
      errors.push("Cette batterie n'a pas d'entrée solaire directe : un onduleur est nécessaire pour la recharger (et pour utiliser l'électricité produite).");
    }
    if (!ctx.battery && !ctx.inverter) {
      errors.push("Sans batterie et sans onduleur, l'électricité produite n'est pas utilisable.");
    }
    const cs = ctx.installProfile.chargeStrategy;
    const ds = ctx.installProfile.dischargeStrategy;
    if (ctx.battery && cs.gridChargeMode !== "off" && !ctx.battery.chargeSchedulable) {
      errors.push('La batterie sélectionnée ne supporte pas le pilotage horaire de charge ("charge déplaçable"), nécessaire pour la recharge réseau en heures creuses.');
    }
    if (ctx.battery && ds.mode !== "asap" && !ctx.battery.dischargeSchedulable) {
      errors.push('La batterie sélectionnée ne supporte pas le pilotage horaire de décharge ("décharge déplaçable"), nécessaire pour cette stratégie de décharge.');
    }
    if (!ctx.battery && cs.gridChargeMode !== "off") {
      errors.push("Aucune batterie sélectionnée : la stratégie de recharge réseau n'a pas d'effet.");
    }
    if (cs.maxSocPct <= ds.minSocPct) {
      errors.push("La limite de charge (%) doit être strictement supérieure à la limite de décharge (%) — voir l'onglet Installation.");
    }
    if (!ctx.consumptionProfile) errors.push("Sélectionnez un profil de consommation.");
    if (ctx.s.location.lat === null) errors.push("Renseignez d'abord une localisation (onglet Localisation).");
    return errors;
  }

  function renderErrors(errors) {
    const box = document.getElementById("simulation-errors");
    const list = document.getElementById("simulation-errors-list");
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
  function recompute() {
    const ctx = buildContext();
    renderPowerChartSection(ctx);

    const errors = validate(ctx);
    renderErrors(errors);

    const resultsEl = document.getElementById("simulation-results");
    resultsEl.innerHTML = "";
    if (errors.length > 0 || !ctx.panel || !ctx.consumptionProfile) {
      const finalSocDisplay = document.getElementById("simulation-final-soc-display");
      if (finalSocDisplay) finalSocDisplay.value = "—";
      return;
    }

    resultsEl.appendChild(renderResults(ctx));
    flushPendingCharts();
  }

  // ------------------------------------------------------------------
  // Production horaire théorique
  // ------------------------------------------------------------------
  function maskForProfile(loc, installProfile) {
    return installProfile.panels.horizonMaskProfileId
      ? ((loc.horizonMaskProfiles.find((p) => p.id === installProfile.panels.horizonMaskProfileId) || {}).mask || [])
      : [];
  }

  function renderPowerChartSection(ctx) {
    const loc = ctx.s.location;
    if (loc.lat === null || loc.lng === null || !ctx.panel || !ctx.installProfile) return;

    const ratedTotalWc = ctx.panel.powerWc * ctx.installProfile.panels.count;
    renderPowerChart(loc, ctx.installProfile.panels, ratedTotalWc, maskForProfile(loc, ctx.installProfile));
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

  // ------------------------------------------------------------------
  // Résultats : 3 graphiques (été/équinoxe/hiver) + coûts
  // ------------------------------------------------------------------
  const SEASONS = [
    { key: "ete", label: "Été (21 juin)" },
    { key: "equinoxe", label: "Équinoxe" },
    { key: "hiver", label: "Hiver (21 décembre)" },
  ];

  function runSimulationForSeason(ctx, seasonKey) {
    const G = window.SolarGeometry;
    const PV = window.PvProduction;
    const loc = ctx.s.location;
    const install = ctx.installProfile;
    const doyMap = {
      ete: G.REFERENCE_DAYS.solsticeEte,
      hiver: G.REFERENCE_DAYS.solsticeHiver,
      equinoxe: G.REFERENCE_DAYS.equinoxe,
    };
    const tzMap = { ete: 2, hiver: 1, equinoxe: 2 }; // heure réelle française, cf. renderPowerChart

    const ratedTotalWc = ctx.panel.powerWc * install.panels.count;

    const powerCurve = PV.dayPowerCurve(
      loc.lat, loc.lng, tzMap[seasonKey], doyMap[seasonKey],
      ratedTotalWc, install.panels.tilt, install.panels.orientation, maskForProfile(loc, install), 10
    );

    return window.BatterySimulation.simulateDay({
      stepMinutes: 10,
      productionPoints: powerCurve.points.map((p) => ({ hour: p.hour, powerW: p.powerW })),
      consumptionSegments: ctx.consumptionProfile.segments,
      tariffs: loc.tariffs,
      sellTariffPerKwh: loc.sellTariffPerKwh,
      battery: ctx.battery,
      batteryCount: 1, // une seule batterie par profil d'installation
      hasInverter: !!ctx.inverter,
      inverterEfficiencyPct: ctx.inverter ? ctx.inverter.efficiencyPct : 100,
      chargeStrategy: install.chargeStrategy,
      dischargeStrategy: install.dischargeStrategy,
      sellMode: install.sellMode,
      initialSocPct: ctx.s.simulationConfig.initialSocPct,
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

  function renderResults(ctx) {
    const wrap = document.createElement("div");
    wrap.className = "card";

    const header = document.createElement("div");
    header.className = "card__header";
    header.innerHTML = '<h2 class="card__title">Résultats</h2>';
    wrap.appendChild(header);

    const results = {};
    SEASONS.forEach((season) => {
      results[season.key] = runSimulationForSeason(ctx, season.key);
    });

    // Niveau de charge en fin de journée simulée, par saison (affiché
    // à côté du niveau de début, dans la carte "Niveau de charge de la
    // batterie")
    const finalSocDisplay = document.getElementById("simulation-final-soc-display");
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

    // Consommation et coût du jour SANS installation (achat 100% au
    // réseau) — référence pour les colonnes "Économie" ci-dessous.
    // Indépendant de la saison : le profil de consommation est le même
    // chaque jour dans notre modèle.
    const baseline = computeBaselineConsumption(ctx.consumptionProfile.segments, ctx.s.location.tariffs);
    const baselineRow = document.createElement("div");
    baselineRow.className = "stat-row";
    baselineRow.style.marginBottom = "14px";
    baselineRow.innerHTML =
      '<div class="stat"><span class="stat__label">Consommation du jour</span>' +
      '<span class="stat__value">' + baseline.kwh.toFixed(2) + '<span class="stat__unit">kWh</span></span></div>' +
      '<div class="stat"><span class="stat__label">Coût du jour (sans installation)</span>' +
      '<span class="stat__value stat__value--battery">' + baseline.cost.toFixed(2) + '<span class="stat__unit">€</span></span></div>';
    wrap.appendChild(baselineRow);

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
      const canvasId = "simulation-chart-" + season.key;
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

  return { init };
})();
