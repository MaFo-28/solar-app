/**
 * tab-strategy.js
 * Onglet 6 — Stratégie.
 *
 * Config matériel indépendante (bac à sable), stratégies de charge/
 * décharge/vente, validation de cohérence, puis simulation pas-à-pas
 * (js/battery-simulation.js) pour chaque profil de consommation
 * choisi, aux 3 dates de référence (été/hiver/équinoxe).
 */
window.TabStrategy = (function () {
  "use strict";

  const charts = {}; // clé "profileId-saison" -> instance Chart.js
  let pendingCharts = [];

  function init() {
    renderPanelSelect();
    renderMaskSelect();
    renderInverterSelect();
    renderBatterySelect();
    renderConsumptionProfileSelects();
    bindFields();
    bindStrategyFields();
    recompute();
  }

  // ------------------------------------------------------------------
  // Sélecteurs d'équipement (base éditable, "Aucun" pour onduleur/batterie)
  // ------------------------------------------------------------------
  function renderPanelSelect() {
    const select = document.getElementById("strategy-panel-select");
    const db = window.AppState.get().panelsDatabase || [];
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
    const db = window.AppState.get().invertersDatabase || [];
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
    const db = window.AppState.get().batteriesDatabase || [];
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
    ["strategy-consumption-profile-1", "strategy-consumption-profile-2"].forEach((id, idx) => {
      const select = document.getElementById(id);
      select.innerHTML = idx === 1 ? '<option value="">Aucun</option>' : "";
      profiles.forEach((p) => {
        const opt = document.createElement("option");
        opt.value = p.id;
        opt.textContent = p.name;
        select.appendChild(opt);
      });
      const s = window.AppState.get().strategy;
      const current = s.consumptionProfileIds[idx];
      if (current && profiles.some((p) => p.id === current)) {
        select.value = current;
      } else if (idx === 0 && profiles.length > 0) {
        select.value = profiles[0].id;
        const st = window.AppState.get();
        const ids = st.strategy.consumptionProfileIds.slice();
        ids[0] = profiles[0].id;
        st.strategy.consumptionProfileIds = ids;
        window.AppState.set("strategy", st.strategy);
      }
      window.bindOnce(select, "change", function () {
        const st = window.AppState.get();
        const ids = st.strategy.consumptionProfileIds.slice();
        ids[idx] = select.value || null;
        st.strategy.consumptionProfileIds = ids.filter((v, i) => v || i === 0);
        window.AppState.set("strategy", st.strategy);
        recompute();
      });
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
    const errors = validate(ctx);
    renderErrors(errors);

    const resultsEl = document.getElementById("strategy-results");
    resultsEl.innerHTML = "";
    if (errors.length > 0 || !ctx.panel) {
      return;
    }

    ctx.consumptionProfiles.forEach((profile) => {
      resultsEl.appendChild(renderProfileResults(ctx, profile));
    });

    flushPendingCharts();
  }

  // ------------------------------------------------------------------
  // Résultats par profil : 3 graphiques (été/hiver/équinoxe) + coûts
  // ------------------------------------------------------------------
  const SEASONS = [
    { key: "ete", label: "Été (21 juin)" },
    { key: "hiver", label: "Hiver (21 décembre)" },
    { key: "equinoxe", label: "Équinoxe" },
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
    });
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

    // Tableau de coûts aux 3 dates
    const table = document.createElement("table");
    table.className = "data-table";
    table.style.marginBottom = "18px";
    table.innerHTML =
      "<thead><tr><th></th><th>Import</th><th>Export</th><th>Coût total</th><th>dont HC</th><th>dont HP</th></tr></thead>" +
      "<tbody>" +
      SEASONS.map((season) => {
        const r = results[season.key];
        return (
          "<tr><td>" + season.label + "</td>" +
          "<td>" + r.totalImportKwh.toFixed(2) + " kWh</td>" +
          "<td>" + r.totalExportKwh.toFixed(2) + " kWh</td>" +
          "<td>" + r.costTotal.toFixed(2) + " €</td>" +
          "<td>" + r.costHc.toFixed(2) + " €</td>" +
          "<td>" + r.costHp.toFixed(2) + " €</td></tr>"
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
