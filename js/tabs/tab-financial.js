/**
 * tab-financial.js
 * Onglet 6 — Bilan financier. Viendra agréger tous les autres onglets
 * (économies annuelles, temps de retour sur investissement, courbe de
 * rentabilité cumulée) ; pour l'instant : prix de l'installation,
 * production mensuelle réaliste (PVGIS) et dégradation des panneaux
 * dans le temps.
 *
 * Le matériel pris en compte est celui du profil d'installation
 * sélectionné ici (state.installationProfiles) — pas les bases de
 * l'onglet Matériel, qui ne font que lister les modèles disponibles
 * sans notion de "installé".
 */
window.TabFinancial = (function () {
  "use strict";

  let monthlyChart = null;
  let degradationChart = null;

  function init() {
    renderInstallSelect();
    recompute();
    bindDatabaseChangeListener();
  }

  // ------------------------------------------------------------------
  // Sélecteur de profil d'installation
  // ------------------------------------------------------------------
  function renderInstallSelect() {
    const select = document.getElementById("financial-install-select");
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
    }
    window.bindOnce(select, "change", function () {
      const st = window.AppState.get();
      st.simulationConfig.installationProfileId = select.value;
      window.AppState.set("simulationConfig", st.simulationConfig);
      recompute();
    });
  }

  /**
   * Se réabonne aux changements faits dans les autres onglets : sans
   * ça, cet onglet resterait figé sur les données du moment de son
   * premier affichage jusqu'à un rechargement de la page.
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
        path === "location"
      ) {
        renderInstallSelect();
        recompute();
      }
    });
  }

  function getSelectedProfile() {
    const s = window.AppState.get();
    const profiles = s.installationProfiles || [];
    return profiles.find((p) => p.id === s.simulationConfig.installationProfileId) || profiles[0] || null;
  }

  function recompute() {
    const install = getSelectedProfile();
    if (!install) return;
    renderInstallationPrice(install);

    const s = window.AppState.get();
    const loc = s.location;
    const panel = (s.panelsDatabase || []).find((p) => p.id === install.panels.selectedModelId) || null;
    if (loc.lat === null || loc.lng === null || !panel) {
      return;
    }

    const ratedTotalWc = panel.powerWc * install.panels.count;
    const mask = install.panels.horizonMaskProfileId
      ? ((loc.horizonMaskProfiles.find((p) => p.id === install.panels.horizonMaskProfileId) || {}).mask || [])
      : [];

    const annualProductionKwh = renderMonthlyProduction(loc, install.panels, ratedTotalWc, mask);
    renderDegradationChart(install.panels, annualProductionKwh);
  }

  // ------------------------------------------------------------------
  // Prix de l'installation — même décomposition que l'onglet
  // Installation (Panneaux / Onduleur / Batterie / Autre / Total),
  // pour le profil sélectionné ici.
  // ------------------------------------------------------------------
  function renderInstallationPrice(install) {
    const s = window.AppState.get();

    const panel = (s.panelsDatabase || []).find((p) => p.id === install.panels.selectedModelId);
    const panelPrice = panel ? panel.priceEur * install.panels.count : 0;

    const inverter = (s.invertersDatabase || []).find((i) => i.id === install.inverter.selectedModelId);
    const inverterPrice = inverter ? inverter.priceEur : 0;

    // Une seule batterie par installation, donc pas de multiplicateur.
    const battery = (s.batteriesDatabase || []).find((b) => b.id === install.battery.selectedModelId);
    const batteryPrice = battery ? battery.priceEur : 0;

    const otherPrice = (install.fixedCosts || []).reduce((sum, line) => sum + (line.priceEur || 0), 0);

    const total = panelPrice + inverterPrice + batteryPrice + otherPrice;

    document.getElementById("stat-cost-panels").textContent = panelPrice.toFixed(0);
    document.getElementById("stat-cost-inverter").textContent = inverterPrice.toFixed(0);
    document.getElementById("stat-cost-battery").textContent = batteryPrice.toFixed(0);
    document.getElementById("stat-cost-other").textContent = otherPrice.toFixed(0);
    document.getElementById("stat-cost-total").textContent = total.toFixed(0);
  }

  // ------------------------------------------------------------------
  // Production mensuelle réaliste (PVGIS)
  // ------------------------------------------------------------------
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

  // ------------------------------------------------------------------
  // Dégradation dans le temps
  // ------------------------------------------------------------------
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

  return { init };
})();
