/**
 * tab-financial.js
 * Onglet 6 — Bilan financier. Viendra agréger tous les autres onglets
 * (économies annuelles, temps de retour sur investissement, courbe de
 * rentabilité cumulée) ; pour l'instant : prix de l'installation,
 * production mensuelle réaliste (PVGIS), dégradation des panneaux dans
 * le temps, et rapport de consommation (import d'un répertoire de
 * fichiers journaliers, calcul HC/HP indépendant de la production).
 *
 * Le matériel pris en compte est celui du profil d'installation
 * sélectionné ici (state.installationProfiles) — pas les bases de
 * l'onglet Matériel, qui ne font que lister les modèles disponibles
 * sans notion de "installé".
 *
 * Le répertoire de consommation (365 fichiers CSV) n'est pas persisté
 * dans le projet ni dans localStorage : c'est une donnée volumineuse
 * (365 x 96 valeurs) qui vit déjà sur le disque de l'utilisateur —
 * seul le rapport mensuel calculé serait pertinent à sauvegarder, mais
 * ça n'est pas demandé pour l'instant. Il faut donc réimporter le
 * répertoire à chaque session.
 */
window.TabFinancial = (function () {
  "use strict";

  let monthlyChart = null;
  let degradationChart = null;
  let annualUtilizationChart = null;
  let consumptionDayCache = null; // { "MM-DD": [96 valeurs W] } une fois un répertoire validé, sinon null

  function init() {
    renderInstallSelect();
    recompute();
    bindDatabaseChangeListener();
    bindConsumptionDirectory();
    renderConsumptionReport();
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
        if (path === "location") renderConsumptionReport(); // tarifs HC/HP potentiellement modifiés
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
    const installCostTotal = renderInstallationPrice(install);

    const s = window.AppState.get();
    const loc = s.location;
    const panel = (s.panelsDatabase || []).find((p) => p.id === install.panels.selectedModelId) || null;
    if (loc.lat === null || loc.lng === null || !panel) {
      return;
    }

    const inverter = (s.invertersDatabase || []).find((i) => i.id === install.inverter.selectedModelId) || null;
    const battery = (s.batteriesDatabase || []).find((b) => b.id === install.battery.selectedModelId) || null;
    const ratedTotalWc = panel.powerWc * install.panels.count;
    const mask = install.panels.horizonMaskProfileId
      ? ((loc.horizonMaskProfiles.find((p) => p.id === install.panels.horizonMaskProfileId) || {}).mask || [])
      : [];

    const annualProductionKwh = renderMonthlyProduction(loc, install.panels, ratedTotalWc, mask);
   // renderDegradationChart(install.panels, annualProductionKwh);
    renderAnnualBalance(install, inverter, battery, mask, ratedTotalWc, installCostTotal);
    renderQuote(install);
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
    const inverterPrice = inverter ? inverter.priceEur * install.inverter.count : 0;

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
    return total;
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
  // Présentation du devis
  // ------------------------------------------------------------------
  function renderQuote(install) {
    const s = window.AppState.get();
  
    const tbody = document.getElementById("financial-quote-table-body");
    const tfoot = document.getElementById("financial-quote-table-foot");
  
    if (!tbody || !tfoot) return;
  
    tbody.innerHTML = "";
  
    const panel = (s.panelsDatabase || []).find(
      (p) => p.id === install.panels.selectedModelId
    );
  
    const inverter = (s.invertersDatabase || []).find(
      (i) => i.id === install.inverter.selectedModelId
    );
  
    const battery = (s.batteriesDatabase || []).find(
      (b) => b.id === install.battery.selectedModelId
    );
  
    const lines = [];
  
    // Panneaux
    if (panel && install.panels.count > 0) {
      lines.push({
        label: `${panel.brand} ${panel.model}`,
        unitPrice: panel.priceEur,
        quantity: install.panels.count
      });
    }
  
    // Onduleur
    if (inverter && install.inverter.count > 0) {
      lines.push({
        label: `${inverter.brand} ${inverter.model}`,
        unitPrice: inverter.priceEur,
        quantity: install.inverter.count
      });
    }
  
    // Batterie
	// Une seule batterie par installation, donc pas de multiplicateur.
    if (battery) {
      lines.push({
        label: `${battery.brand} ${battery.model}`,
        unitPrice: battery.priceEur,
        quantity: 1
      });
    }
  
    // Ajouts libres
    (install.fixedCosts || []).forEach((line) => {
      lines.push({
        label: line.label,
        unitPrice: line.priceEur || 0,
        quantity: 1
      });
    });
  
    let total = 0;
  
    lines.forEach((line) => {
      const lineTotal = line.unitPrice * line.quantity;
      total += lineTotal;
  
      const tr = document.createElement("tr");
  
      tr.innerHTML =
        `<td>${escapeHtml(line.label)}</td>` +
        `<td>${line.unitPrice.toLocaleString("fr-FR", {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2
        })} €</td>` +
        `<td>${line.quantity}</td>` +
        `<td>${lineTotal.toLocaleString("fr-FR", {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2
        })} €</td>`;
  
      tbody.appendChild(tr);
    });
  
    tfoot.innerHTML =
      `<tr class="stat__total">` +
      `<th colspan="3">Total</th>` +
      `<th>${total.toLocaleString("fr-FR", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      })} €</th>` +
      `</tr>`;
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

  // ------------------------------------------------------------------
  // Bilan annuel : moteur de simulation 365 jours (annual-simulation.js),
  // à partir du cache horaire PVGIS (irradiance réelle) et du répertoire
  // de consommation importé ci-dessous. Complète la barre 1 existante
  // (production mensuelle réaliste, inchangée) par la répartition de la
  // consommation, la courbe 365 jours et les indicateurs clés.
  // ------------------------------------------------------------------
  function renderAnnualBalance(install, inverter, battery, mask, ratedTotalWc, installCostTotal) {
    const hint = document.getElementById("financial-annual-hint");
    const totalWrap = document.getElementById("financial-annual-total-wrap");
    const utilCard = document.getElementById("financial-utilization-card");
    const indicatorsCard = document.getElementById("financial-indicators-card");

    const s = window.AppState.get();
    const loc = s.location;
    const hourlyCache = loc.pvgisHourlyCache;

    function hideAnnualSections(message) {
      hint.style.display = "block";
      hint.textContent = message;
      totalWrap.style.display = "none";
      utilCard.style.display = "none";
      indicatorsCard.style.display = "none";
      if (monthlyChart) {
        monthlyChart.data.datasets = monthlyChart.data.datasets.slice(0, 1);
        monthlyChart.options.plugins.legend.display = false;
        monthlyChart.update();
      }
      if (annualUtilizationChart) {
        annualUtilizationChart.destroy();
        annualUtilizationChart = null;
      }
    }

    if (!hourlyCache || !consumptionDayCache) {
      hideAnnualSections(
        "Importez d'abord les données horaires PVGIS (onglet Localisation) et un répertoire de consommation valide (section ci-dessus) pour voir la répartition de la consommation, la courbe 365 jours et les indicateurs clés."
      );
      return;
    }

    const expected = expectedDayKeys();
    const hourlyByKey = {};
    hourlyCache.days.forEach((d) => {
      hourlyByKey[String(d.month).padStart(2, "0") + "-" + String(d.day).padStart(2, "0")] = d;
    });
    if (expected.some((k) => !hourlyByKey[k])) {
      hideAnnualSections(
        "Le cache horaire PVGIS de l'onglet Localisation ne couvre pas les 365 jours de l'année (import incomplet) — réimportez-le."
      );
      return;
    }

    hint.style.display = "none";
    totalWrap.style.display = "flex";
    utilCard.style.display = "block";
    indicatorsCard.style.display = "block";

    const result = window.AnnualSimulation.simulateYear({
      pvgisHourlyDaysByKey: hourlyByKey,
      consumptionDaysByKey: consumptionDayCache,
      lat: loc.lat,
      lng: loc.lng,
      ratedTotalWc,
      tiltDeg: install.panels.tilt,
      orientationDeg: install.panels.orientation,
      mask,
      battery,
      hasInverter: !!inverter,
      inverterEfficiencyPct: inverter ? inverter.efficiencyPct : 100,
      chargeStrategy: install.chargeStrategy,
      dischargeStrategy: install.dischargeStrategy,
      sellMode: install.sellMode,
      tariffs: loc.tariffs,
      sellTariffPerKwh: loc.sellTariffPerKwh,
      initialSocPct: 10,
    });

    document.getElementById("stat-annual-consumed-gross").textContent = result.indicators.productionConsommeeTotalKWh.toFixed(0);
    document.getElementById("stat-annual-consumed-net").textContent = result.indicators.productionConsommeeNetKWh.toFixed(0);
    document.getElementById("stat-annual-savings").textContent = result.indicators.economieRealiseeEur.toFixed(0);
    document.getElementById("stat-annual-simulated").textContent = result.indicators.productionSimuleeTotalKWh.toFixed(0);
    document.getElementById("stat-annual-sold").textContent = result.indicators.surplusInjecteKWh.toFixed(0);
    document.getElementById("stat-annual-network-consumed").textContent = result.indicators.consommationTotaleReseauKWh.toFixed(0);
	
    document.getElementById("stat-annual-charged").textContent = result.indicators.energieChargeeBatterieTotalKWh.toFixed(0);
    document.getElementById("stat-annual-decharged").textContent = result.indicators.energieDechargeeBatterieTotalKWh.toFixed(0);

    renderConsumptionStackOnMonthlyChart(result.months);
    renderUtilizationChart(result.days, result.hasBattery);
    renderIndicators(result.indicators, installCostTotal);
  }

  /**
   * Ajoute la barre 2 (empilement autoconsommation directe / batterie /
   * réseau) au graphique déjà tracé par renderMonthlyProduction, sans
   * toucher à la barre 1 (production mensuelle réaliste, dataset 0).
   */
  function renderConsumptionStackOnMonthlyChart(months) {
    if (!monthlyChart) return;
    monthlyChart.data.datasets = monthlyChart.data.datasets.slice(0, 1);
    monthlyChart.data.datasets[0].stack = "prod";
    monthlyChart.data.datasets.push(
      {
        label: "Autoconsommation directe",
        data: months.map((m) => m.productionAutoconsommeeDirecteKWh),
        backgroundColor: "rgba(62,201,167,0.65)",
        stack: "conso",
        borderRadius: 3,
      },
      {
        label: "Autoconsommation batterie",
        data: months.map((m) => m.productionViaBatterieKWh),
        backgroundColor: "rgba(155,140,255,0.65)",
        stack: "conso",
        borderRadius: 3,
      },
      {
        label: "Réseau",
        data: months.map((m) => m.consommationReseauKWh),
        backgroundColor: "rgba(224,87,91,0.65)",
        stack: "conso",
        borderRadius: 3,
      }
    );
    monthlyChart.options.plugins.legend.display = true;
    monthlyChart.update();
  }

  function renderUtilizationChart(days, hasBattery) {
    const datasets = [
      {
        label: "Taux d'utilisation panneaux (%)",
        data: days.map((d) =>
          d.productionReelleKWh > 0
            ? ((d.productionAutoconsommeeDirecteKWh + d.chargeeDansBatterieKWh) / d.productionReelleKWh) * 100
            : 0
        ),
        borderColor: "#f5a623",
        backgroundColor: "rgba(245,166,35,0.08)",
        pointRadius: 0,
        borderWidth: 1,
        tension: 0.1,
      },
    ];
    if (hasBattery) {
      datasets.push({
        label: "Pic de charge batterie (%)",
        data: days.map((d) => d.picChargeBatteriePct),
        //borderColor: "#9b8cff",
        //backgroundColor: "rgba(155,140,255,0.08)",
		borderColor: "#9b59b6",
		backgroundColor: "rgba(155,89,182,0.08)",
        pointRadius: 0,
        borderWidth: 1,
        tension: 0.1,
      });
    }
	if (hasBattery) {
	  datasets.push({
		label: "Décharge batterie (%)",
		data: days.map((d) => d.picDechargeBatteriePct),
		borderColor: "#5bc0eb",
		backgroundColor: "rgba(91,192,235,0.08)",
		pointRadius: 0,
		borderWidth: 1,
		tension: 0.1,
	  });
	}

	if (hasBattery) {
	  datasets.push({
		label: "Utilisation batterie (%)",
		data: days.map((d) => d.moyenneUtilisationBatteriePct),
		borderColor: "#5cb85c",
		backgroundColor: "rgba(92,184,92,0.08)",
		pointRadius: 0,
		borderWidth: 1,
		tension: 0.1,
	  });
	}

    const ctx2d = document.getElementById("chart-annual-utilization").getContext("2d");
    if (annualUtilizationChart) annualUtilizationChart.destroy();
    annualUtilizationChart = new Chart(ctx2d, {
      type: "line",
      data: { labels: days.map((d, i) => i + 1), datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
			x: {
			  title: { display: true, text: "Mois", color: "#9a9ea8" },

			  afterBuildTicks: function(axis) {
				const joursDebutMois = [
				  1, 32, 60, 91, 121, 152,
				  182, 213, 244, 274, 305, 335
				];

				axis.ticks = joursDebutMois.map(jour => ({
				  value: jour - 1
				}));
			  },

			  ticks: {
				color: "#9a9ea8",
				callback: function(value) {
				  const mois = [
					"Jan", "Fév", "Mar", "Avr", "Mai", "Juin",
					"Juil", "Août", "Sep", "Oct", "Nov", "Déc"
				  ];

				  const jour = Number(value) + 1;

				  const debutMois = [
					1, 32, 60, 91, 121, 152,
					182, 213, 244, 274, 305, 335
				  ];

				  const indexMois = debutMois.findIndex((debut, i) =>
					jour >= debut && (i === 11 || jour < debutMois[i + 1])
				  );

				  return indexMois >= 0 ? mois[indexMois] : "";
				},
			  },

			  grid: {
				color: "#23272f",
			  },
			},
          y: {
            min: 0,
            max: 100,
            title: { display: true, text: "%", color: "#9a9ea8" },
            ticks: { color: "#9a9ea8" },
            grid: { color: "#23272f" },
          },
        },
        plugins: {
          legend: { labels: { color: "#e9e7e0" } },
        },
      },
    });
  }

  function renderIndicators(indicators, installCostTotal) {
    document.getElementById("stat-taux-autoconsommation").textContent = indicators.tauxAutoconsommationPct.toFixed(0);
    document.getElementById("stat-taux-autoproduction").textContent = indicators.tauxAutoproductionPct.toFixed(0);
    document.getElementById("stat-indicator-savings").textContent = indicators.economieRealiseeEur.toFixed(0);
    document.getElementById("stat-indicator-resale").textContent = indicators.economieReventeEur.toFixed(0);
//    document.getElementById("stat-indicator-cost").textContent = installCostTotal.toFixed(0);
    const roi = installCostTotal > 0 && indicators.economieRealiseeEur > 0
      ? installCostTotal / indicators.economieRealiseeEur
      : null;
    document.getElementById("stat-indicator-roi").textContent = roi !== null ? roi.toFixed(1) : "—";
  }

  // ------------------------------------------------------------------
  // Profil de consommation : import d'un répertoire de 365 fichiers
  // journaliers (un par jour de l'année, nommés MM-DD.csv), avec
  // vérification stricte du format avant tout calcul — voir
  // validateConsumptionDirectory ci-dessous pour le détail des règles.
  // ------------------------------------------------------------------
  /** Les 365 clés "MM-DD" attendues, dans l'ordre du calendrier. */
  function expectedDayKeys() {
    const U = window.ConsumptionUtils;
    const keys = [];
    for (let m = 0; m < 12; m++) {
      for (let d = 1; d <= U.DAYS_IN_MONTH[m]; d++) {
        keys.push(String(m + 1).padStart(2, "0") + "-" + String(d).padStart(2, "0"));
      }
    }
    return keys;
  }

  function bindConsumptionDirectory() {
    window.bindOnce(document.getElementById("financial-consumption-dir-select"), "click", async function () {
      if (window.showDirectoryPicker) {
        try {
          const dirHandle = await window.showDirectoryPicker();
          const files = [];
          for await (const [name, handle] of dirHandle.entries()) {
            if (handle.kind === "file" && /\.csv$/i.test(name)) {
              const file = await handle.getFile();
              files.push({ name, text: await file.text() });
            }
          }
          processConsumptionDirectory(dirHandle.name, files);
        } catch (err) {
          if (err && err.name === "AbortError") return;
          console.warn(err);
          setConsumptionStatus("Erreur : impossible de lire ce répertoire.", []);
        }
        return;
      }
      // Repli (Firefox, Safari) : sélecteur de répertoire classique via
      // input file + webkitdirectory, mêmes principes que le picker natif.
      document.getElementById("financial-consumption-dir-input").click();
    });

    window.bindOnce(document.getElementById("financial-consumption-dir-input"), "change", function (e) {
      const fileList = Array.from(e.target.files || []);
      e.target.value = ""; // permet de réimporter le même répertoire deux fois de suite
      if (fileList.length === 0) return;
      const csvFiles = fileList.filter((f) => /\.csv$/i.test(f.name));
      const dirName = (fileList[0].webkitRelativePath || fileList[0].name).split("/")[0];
      const reads = csvFiles.map(
        (f) =>
          new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (ev) => resolve({ name: f.name, text: ev.target.result });
            reader.onerror = () => reject(new Error("lecture impossible : " + f.name));
            reader.readAsText(f);
          })
      );
      Promise.all(reads)
        .then((files) => processConsumptionDirectory(dirName, files))
        .catch((err) => setConsumptionStatus("Erreur : " + err.message, []));
    });
  }

  function processConsumptionDirectory(dirName, files) {
    const result = validateConsumptionDirectory(files);
    document.getElementById("financial-consumption-dir-name").textContent = dirName;
    if (!result.valid) {
      consumptionDayCache = null;
      setConsumptionStatus(
        result.errors.length + " erreur(s) trouvée(s) — répertoire rejeté, corrigez les fichiers puis réimportez.",
        result.errors
      );
      renderConsumptionReport();
      recompute();
      return;
    }
    consumptionDayCache = result.days;
    setConsumptionStatus("✓ Répertoire valide : 365 fichiers chargés.", []);
    renderConsumptionReport();
    recompute();
  }

  function setConsumptionStatus(text, errors) {
    document.getElementById("financial-consumption-status").textContent = text;
    const list = document.getElementById("financial-consumption-errors");
    if (!errors || errors.length === 0) {
      list.style.display = "none";
      list.innerHTML = "";
    } else {
      list.innerHTML = errors.map((e) => "<li>" + escapeHtml(e) + "</li>").join("");
      list.style.display = "block";
    }
  }

  /**
   * Valide un répertoire de consommation en 2 passes, dans cet ordre :
   *  1) l'ensemble des noms de fichiers (365 attendus, aucun manquant,
   *     aucun en trop, aucun mal nommé/doublon) ;
   *  2) le contenu de chaque fichier (en-tête, nombre de lignes, heures,
   *     valeurs numériques) — seulement si la passe 1 est déjà propre,
   *     pour ne pas noyer l'utilisateur sous des erreurs de contenu
   *     quand le vrai problème est un fichier manquant ou mal nommé.
   *
   * Retourne { valid, errors, days } où days est { "MM-DD": [96 W] }
   * si valid, sinon null.
   */
  function validateConsumptionDirectory(files) {
    const errors = [];
    const byKey = {};
    const nameRe = /^(\d{2})-(\d{2})\.csv$/i;
    const expected = expectedDayKeys();
    const expectedSet = new Set(expected);

    files.forEach((f) => {
      const m = nameRe.exec(f.name);
      if (!m) {
        errors.push(f.name + " : nom de fichier invalide (attendu MM-DD.csv).");
        return;
      }
      const key = m[1] + "-" + m[2];
      if (!expectedSet.has(key)) {
        errors.push(f.name + " : date inexistante dans le calendrier (mois ou jour invalide).");
        return;
      }
      if (byKey[key]) {
        errors.push(f.name + " : doublon (un autre fichier correspond déjà à " + key + ".csv).");
        return;
      }
      byKey[key] = f.text;
    });

    expected.forEach((key) => {
      if (!byKey[key]) errors.push(key + ".csv : fichier manquant.");
    });

    if (errors.length > 0) return { valid: false, errors, days: null };

    const days = {};
    expected.forEach((key) => {
      const values = parseDayFile(key + ".csv", byKey[key], errors);
      if (values) days[key] = values;
    });

    if (errors.length > 0) return { valid: false, errors, days: null };
    return { valid: true, errors: [], days };
  }

  /**
   * Valide et parse un fichier journalier ("heure;puissance_w", 96
   * lignes de 00:00 à 23:45 par pas de 15 min) — délègue à
   * ConsumptionUtils.parseQuarterHourCsv, partagée avec l'import de
   * profil isolé de l'onglet Consommation, pour ne pas dupliquer les
   * règles de rejet. Retourne le tableau des 96 puissances (W) si tout
   * est conforme, sinon null (les erreurs précises, préfixées par le
   * nom du fichier, sont poussées dans le tableau `errors` partagé).
   */
  function parseDayFile(fileName, text, errors) {
    const result = window.ConsumptionUtils.parseQuarterHourCsv(text);
    result.errors.forEach((e) => errors.push(fileName + " : " + e));
    return result.values;
  }

  /**
   * Rapport mensuel HC/HP : pur calcul consommation × tarifs, sans lien
   * avec la production solaire ou la batterie. Chaque journée (96
   * valeurs à pas de 15 min) est convertie en "plages" de 15 min pour
   * réutiliser telle quelle dayCost() — la même fonction qui sert déjà
   * au coût du jour et au calendrier de l'onglet Consommation — plutôt
   * que de recalculer la répartition HC/HP séparément ici.
   */
  function computeConsumptionReport(days, tariffs) {
    const U = window.ConsumptionUtils;
    const months = [];
    for (let m = 0; m < 12; m++) {
      const totals = { hpKwh: 0, hcKwh: 0, hpCost: 0, hcCost: 0 };
      for (let d = 1; d <= U.DAYS_IN_MONTH[m]; d++) {
        const key = String(m + 1).padStart(2, "0") + "-" + String(d).padStart(2, "0");
        const values = days[key];
        const segments = values.map((v, i) => ({ startHour: i * 0.25, endHour: i * 0.25 + 0.25, powerW: v }));
        const day = U.dayCost(segments, tariffs);
        totals.hpKwh += day.hpKwh;
        totals.hcKwh += day.hcKwh;
        totals.hpCost += day.hp;
        totals.hcCost += day.hc;
      }
      months.push(totals);
    }
    return months;
  }

  function consumptionReportRowHtml(label, t, isTotal) {
    const totalKwh = t.hpKwh + t.hcKwh;
    const totalCost = t.hpCost + t.hcCost;
    //const style = isTotal ? ' style="font-weight:600;"' : "";
	const className = isTotal ? ' class="stat__total"' : "";
    return (
      "<tr" + className + "><td>" + escapeHtml(label) + "</td>" +
      "<td>" + t.hpKwh.toFixed(2) + "</td>" +
      "<td>" + t.hcKwh.toFixed(2) + "</td>" +
      "<td>" + totalKwh.toFixed(2) + "</td>" +
      "<td>" + t.hpCost.toFixed(2) + "</td>" +
      "<td>" + t.hcCost.toFixed(2) + "</td>" +
      "<td>" + totalCost.toFixed(2) + "</td></tr>"
    );
  }

  function renderConsumptionReport() {
    const hint = document.getElementById("financial-consumption-report-hint");
    const table = document.getElementById("financial-consumption-report-table");
    if (!consumptionDayCache) {
      hint.style.display = "block";
      table.style.display = "none";
      return;
    }

    const U = window.ConsumptionUtils;
    const tariffs = window.AppState.get().location.tariffs;
    const months = computeConsumptionReport(consumptionDayCache, tariffs);
    const grand = months.reduce(
      (acc, t) => ({
        hpKwh: acc.hpKwh + t.hpKwh,
        hcKwh: acc.hcKwh + t.hcKwh,
        hpCost: acc.hpCost + t.hpCost,
        hcCost: acc.hcCost + t.hcCost,
      }),
      { hpKwh: 0, hcKwh: 0, hpCost: 0, hcCost: 0 }
    );

    document.getElementById("financial-consumption-report-body").innerHTML = months
      .map((t, i) => consumptionReportRowHtml(U.MONTH_NAMES[i], t))
      .join("");
    document.getElementById("financial-consumption-report-foot").innerHTML =
      consumptionReportRowHtml("Total annuel", grand, true);

    hint.style.display = "none";
    table.style.display = "";
  }

  function escapeHtml(str) {
    return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  return { init };
})();
