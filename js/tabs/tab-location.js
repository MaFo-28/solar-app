/**
 * tab-location.js
 * Onglet 1 — Localisation.
 *
 * Responsabilités :
 *  - géocodage adresse -> lat/lng (Nominatim/OSM, gratuit, sans clé) OU saisie manuelle
 *  - calcul des angles solaires aux solstices (élévation max, risque d'ombre)
 *  - tracé de la courbe d'élévation solaire sur 24h aux solstices
 *  - récupération PVGIS (irradiance mensuelle et horaire), mise en cache dans l'état
 *  - édition des tarifs électriques (plages HC/HP, extensible)
 *  - boutons Charger / Enregistrer (état complet du projet)
 */
window.TabLocation = (function () {
  "use strict";

  let elevationChart = null;

  // ------------------------------------------------------------------
  // Profils de masque d'horizon : un seul actif/affiché à la fois
  // ------------------------------------------------------------------
  function getActiveProfile() {
    const loc = window.AppState.get().location;
    return (
      loc.horizonMaskProfiles.find((p) => p.id === loc.activeHorizonMaskProfileId) ||
      loc.horizonMaskProfiles[0]
    );
  }

  function getActiveMask() {
    const profile = getActiveProfile();
    return profile ? profile.mask : [];
  }

  function setActiveMask(newMask) {
    const s = window.AppState.get();
    const profile = s.location.horizonMaskProfiles.find(
      (p) => p.id === s.location.activeHorizonMaskProfileId
    );
    if (profile) profile.mask = newMask;
    window.AppState.set("location", s.location);
  }

  /** Repeint tout ce qui dépend du profil actif : sélecteur, table, graphiques. */
  function refreshMaskUI() {
    renderProfileSelect();
    renderMaskTable();
    refreshAzimuthChartIfReady();
  }

  function init() {
    renderTariffTable();
    bindGeocodeForm();
    bindManualLatLng();
    bindPvgisButton();
    bindPvgisHourlyButtons();
    bindTariffAddRow();
    bindHorizonThreshold();
    bindSellTariff();
    renderProfileSelect();
    bindProfileButtons();
    renderMaskTable();
    bindMaskAddRow();
    bindCalculator();

    // si un état existant a déjà une position, on affiche direct
    const loc = window.AppState.get().location;
    if (loc.lat !== null && loc.lng !== null) {
      document.getElementById("loc-lat").value = loc.lat;
      document.getElementById("loc-lng").value = loc.lng;
      document.getElementById("loc-address").value = loc.label || "";
      computeAndRender(loc.lat, loc.lng);
    }
  }

  // ------------------------------------------------------------------
  // Géocodage (adresse -> coordonnées)
  // ------------------------------------------------------------------
  function bindGeocodeForm() {
    const form = document.getElementById("loc-geocode-form");
    window.bindOnce(form, "submit", async function (e) {
      e.preventDefault();
      const address = document.getElementById("loc-address").value.trim();
      if (!address) return;

      const statusEl = document.getElementById("loc-geocode-status");
      statusEl.textContent = "Recherche en cours…";

      try {
        const url =
          "https://nominatim.openstreetmap.org/search?format=json&limit=1&q=" +
          encodeURIComponent(address);
        const res = await fetch(url, { headers: { Accept: "application/json" } });
        if (!res.ok) throw new Error("Réponse réseau invalide");
        const results = await res.json();
        if (!results.length) {
          statusEl.textContent = "Adresse introuvable. Essayez une saisie manuelle ci-dessous.";
          return;
        }
        const lat = parseFloat(results[0].lat);
        const lng = parseFloat(results[0].lon);
        document.getElementById("loc-lat").value = lat.toFixed(5);
        document.getElementById("loc-lng").value = lng.toFixed(5);
        statusEl.textContent = "Trouvé : " + results[0].display_name;
        applyLocation(address, lat, lng);
      } catch (err) {
        statusEl.textContent =
          "Géocodage indisponible (pas de réseau ?). Utilisez la saisie manuelle ci-dessous.";
        console.warn(err);
      }
    });
  }

  // ------------------------------------------------------------------
  // Saisie manuelle lat/lng (secours, ou correction fine)
  // ------------------------------------------------------------------
  function bindManualLatLng() {
    window.bindOnce(document.getElementById("loc-apply-manual"), "click", function () {
      const lat = parseFloat(document.getElementById("loc-lat").value);
      const lng = parseFloat(document.getElementById("loc-lng").value);
      if (Number.isNaN(lat) || Number.isNaN(lng)) {
        alert("Latitude/longitude invalides.");
        return;
      }
      applyLocation(document.getElementById("loc-address").value.trim(), lat, lng);
    });
  }

  function applyLocation(label, lat, lng) {
    const s = window.AppState.get();
    s.location.label = label;
    s.location.lat = lat;
    s.location.lng = lng;
    window.AppState.set("location", s.location);
    computeAndRender(lat, lng);
  }

  // ------------------------------------------------------------------
  // Calcul géométrie solaire + affichage chiffres/courbes
  // ------------------------------------------------------------------
  function computeAndRender(lat, lng) {
    const G = window.SolarGeometry;
    const tz = window.AppState.get().location.timezoneOffset;

    const elevEte = G.maxElevationForDay(lat, G.REFERENCE_DAYS.solsticeEte);
    const elevHiver = G.maxElevationForDay(lat, G.REFERENCE_DAYS.solsticeHiver);
    const elevEquinoxe = G.maxElevationForDay(lat, G.REFERENCE_DAYS.equinoxe);

    document.getElementById("stat-elev-ete").textContent = elevEte.toFixed(1);
    document.getElementById("stat-elev-hiver").textContent = elevHiver.toFixed(1);
    document.getElementById("stat-elev-equinoxe").textContent = elevEquinoxe.toFixed(1);

    // alerte simple risque d'ombre : hauteur hiver faible = ombres portées longues
    const shadeWarning = document.getElementById("loc-shade-warning");
    if (elevHiver < 20) {
      shadeWarning.textContent =
        "Élévation faible en hiver (" +
        elevHiver.toFixed(1) +
        "°) : les ombres portées (bâtiments, arbres, reliefs) seront longues. À vérifier sur site.";
      shadeWarning.style.display = "block";
    } else {
      shadeWarning.style.display = "none";
    }

    renderSunTimes(lat, lng, tz);
    renderElevationChart(lat, lng, tz);
    renderAzimuthChart(lat, lng, tz);
  }

  /**
   * Lever/coucher (heure + azimut sud-relatif) pour les deux
   * solstices, au seuil d'élévation choisi par l'utilisateur.
   * -90°=Est, 0°=Sud, +90°=Ouest — même convention que l'orientation
   * des panneaux dans l'onglet 2, pour pouvoir comparer directement.
   */
  function renderSunTimes(lat, lng, tz) {
    const G = window.SolarGeometry;
    const threshold = window.AppState.get().location.horizonThresholdDeg;

    const rEte = G.sunTimesForDay(lat, lng, tz, G.REFERENCE_DAYS.solsticeEte, threshold);
    const rHiver = G.sunTimesForDay(lat, lng, tz, G.REFERENCE_DAYS.solsticeHiver, threshold);

    fillSunTime("ete-lever", rEte, "sunrise");
    fillSunTime("ete-coucher", rEte, "sunset");
    fillSunTime("hiver-lever", rHiver, "sunrise");
    fillSunTime("hiver-coucher", rHiver, "sunset");
  }

  function fillSunTime(prefix, result, kind) {
    const hourEl = document.getElementById("stat-" + prefix + "-h");
    const azEl = document.getElementById("stat-" + prefix + "-az");
    if (result.polarDay || result.polarNight) {
      hourEl.textContent = "—";
      azEl.textContent = result.polarDay ? "jour polaire" : "nuit polaire";
      return;
    }
    const hour = kind === "sunrise" ? result.sunriseHour : result.sunsetHour;
    const az = kind === "sunrise" ? result.sunriseAzimuthSouth : result.sunsetAzimuthSouth;
    hourEl.textContent = formatHour(hour);
    azEl.textContent = (az >= 0 ? "+" : "") + az.toFixed(0) + "°";
  }

  function formatHour(hourDecimal) {
    let h = Math.floor(hourDecimal);
    let m = Math.round((hourDecimal - h) * 60);
    if (m === 60) { m = 0; h += 1; }
    h = ((h % 24) + 24) % 24;
    return String(h).padStart(2, "0") + "h" + String(m).padStart(2, "0");
  }

  function bindHorizonThreshold() {
    const input = document.getElementById("loc-horizon-threshold");
    input.value = window.AppState.get().location.horizonThresholdDeg;
    window.bindOnce(input, "change", function () {
      const s = window.AppState.get();
      s.location.horizonThresholdDeg = parseFloat(input.value) || 0;
      window.AppState.set("location", s.location);
      if (s.location.lat !== null) {
        renderSunTimes(s.location.lat, s.location.lng, s.location.timezoneOffset);
      }
    });
  }

  function renderElevationChart(lat, lng, tz) {
    const G = window.SolarGeometry;
    const curveEte = G.dayCurve(lat, lng, tz, G.REFERENCE_DAYS.solsticeEte, 10);
    const curveHiver = G.dayCurve(lat, lng, tz, G.REFERENCE_DAYS.solsticeHiver, 10);
    const curveEquinoxe = G.dayCurve(lat, lng, tz, G.REFERENCE_DAYS.equinoxe, 10);

    const datasets = [
      {
        label: "Solstice d'été (21 juin)",
        data: curveEte.map((p) => ({ x: p.hour, y: p.elevation })),
        borderColor: "#f5a623",
        backgroundColor: "rgba(245,166,35,0.12)",
        fill: true,
        tension: 0.25,
        pointRadius: 0,
      },
      {
        label: "Solstice d'hiver (21 décembre)",
        data: curveHiver.map((p) => ({ x: p.hour, y: p.elevation })),
        borderColor: "#3ec9a7",
        backgroundColor: "rgba(62,201,167,0.12)",
        fill: true,
        tension: 0.25,
        pointRadius: 0,
      },
      {
        label: "Équinoxe",
        data: curveEquinoxe.map((p) => ({ x: p.hour, y: p.elevation })),
        borderColor: "#9b8cff",
        backgroundColor: "rgba(155,140,255,0.08)",
        fill: false,
        borderDash: [4, 3],
        tension: 0.25,
        pointRadius: 0,
      },
    ];

    // Superposition des heures masquées par les obstacles renseignés :
    // un vrai rectangle plein (0 -> hauteur de l'obstacle) sur chaque
    // plage horaire masquée, même logique que le graphique par azimut.
    const mask = getActiveMask();
    if (mask.length > 0) {
      const maskedRectangles = (curve) => {
        // repère les points masqués et leur hauteur d'obstacle
        const withMask = curve.map((p) => {
          const azSouth = G.azimuthToSouthRelative(p.azimuth);
          const maskHeight = maskElevationAt(mask, azSouth);
          return { hour: p.hour, masked: p.elevation < maskHeight, maskHeight };
        });

        // regroupe les points masqués consécutifs en segments contigus
        const segments = [];
        let current = null;
        withMask.forEach((p) => {
          if (p.masked) {
            if (!current) current = { start: p.hour, end: p.hour, maxHeight: p.maskHeight };
            else {
              current.end = p.hour;
              current.maxHeight = Math.max(current.maxHeight, p.maskHeight);
            }
          } else if (current) {
            segments.push(current);
            current = null;
          }
        });
        if (current) segments.push(current);

        // construit un rectangle plein par segment, séparés par un trou
        const points = [];
        segments.forEach((seg, idx) => {
          if (idx > 0) points.push({ x: seg.start, y: null });
          points.push({ x: seg.start, y: 0 });
          points.push({ x: seg.start, y: seg.maxHeight });
          points.push({ x: seg.end, y: seg.maxHeight });
          points.push({ x: seg.end, y: 0 });
        });
        return points;
      };

      datasets.push({
        label: "Heures masquées — été",
        data: maskedRectangles(curveEte),
        borderColor: "#e0575b",
        backgroundColor: "rgba(224,87,91,0.35)",
        fill: "origin",
        pointRadius: 0,
        stepped: false,
        tension: 0,
        spanGaps: false,
      });
      datasets.push({
        label: "Heures masquées — hiver",
        data: maskedRectangles(curveHiver),
        borderColor: "#e0575b",
        backgroundColor: "rgba(224,87,91,0.35)",
        fill: "origin",
        pointRadius: 0,
        stepped: false,
        tension: 0,
        spanGaps: false,
      });
      datasets.push({
        label: "Heures masquées — équinoxe",
        data: maskedRectangles(curveEquinoxe),
        borderColor: "#e0575b",
        backgroundColor: "rgba(224,87,91,0.35)",
        fill: "origin",
        pointRadius: 0,
        stepped: false,
        tension: 0,
        spanGaps: false,
      });
    }

    const ctx = document.getElementById("chart-elevation").getContext("2d");
    if (elevationChart) elevationChart.destroy();

    elevationChart = new Chart(ctx, {
      type: "line",
      data: { datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
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
            max: 90,
            title: { display: true, text: "Élévation solaire (°)", color: "#9a9ea8" },
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

  // ------------------------------------------------------------------
  // Courbe azimut (sud-relatif) — pour évaluer le risque d'ombre
  // ------------------------------------------------------------------
  let azimuthChart = null;

  function renderAzimuthChart(lat, lng, tz) {
    const G = window.SolarGeometry;
    const buildSeries = (doy) =>
      G.dayCurve(lat, lng, tz, doy, 5).map((p) => ({
        x: G.azimuthToSouthRelative(p.azimuth),
        y: p.elevation,
      }));

    const seriesEte = buildSeries(G.REFERENCE_DAYS.solsticeEte);
    const seriesHiver = buildSeries(G.REFERENCE_DAYS.solsticeHiver);
    const seriesEquinoxe = buildSeries(G.REFERENCE_DAYS.equinoxe);

    const mask = getActiveMask();

    const datasets = [
      {
        label: "Solstice d'été",
        data: seriesEte,
        borderColor: "#f5a623",
        backgroundColor: "transparent",
        pointRadius: 0,
        tension: 0.15,
      },
      {
        label: "Solstice d'hiver",
        data: seriesHiver,
        borderColor: "#3ec9a7",
        backgroundColor: "transparent",
        pointRadius: 0,
        tension: 0.15,
      },
      {
        label: "Équinoxe",
        data: seriesEquinoxe,
        borderColor: "#9b8cff",
        backgroundColor: "transparent",
        borderDash: [4, 3],
        pointRadius: 0,
        tension: 0.15,
      },
    ];

    if (mask.length > 0) {
      // Chaque obstacle devient un rectangle plein : 4 coins tracés par
      // des segments de droite (verticale-horizontale-verticale), les
      // obstacles étant séparés par un point y=null qui casse le trait
      // (pas de ligne parasite entre deux obstacles distincts).
      const maskPoints = [];
      mask.forEach((m, idx) => {
        if (idx > 0) maskPoints.push({ x: m.azimuthStart, y: null });
        maskPoints.push({ x: m.azimuthStart, y: 0 });
        maskPoints.push({ x: m.azimuthStart, y: m.elevationDeg });
        maskPoints.push({ x: m.azimuthEnd, y: m.elevationDeg });
        maskPoints.push({ x: m.azimuthEnd, y: 0 });
      });

      datasets.push({
        label: "Obstacles (masque d'horizon)",
        data: maskPoints,
        borderColor: "#e0575b",
        backgroundColor: "rgba(224,87,91,0.35)",
        fill: "origin",
        pointRadius: 0,
        stepped: false,
        tension: 0,
        spanGaps: false,
      });
    }

    const ctx = document.getElementById("chart-azimuth").getContext("2d");
    if (azimuthChart) azimuthChart.destroy();

    azimuthChart = new Chart(ctx, {
      type: "line",
      data: { datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "nearest", axis: "x", intersect: false },
        scales: {
          x: {
            type: "linear",
            min: -180,
            max: 180,
            title: { display: true, text: "Azimut (° depuis le Sud, - = Est, + = Ouest)", color: "#9a9ea8" },
            ticks: { color: "#9a9ea8", stepSize: 30 },
            grid: { color: "#23272f" },
          },
          y: {
            min: 0,
            max: 90,
            title: { display: true, text: "Élévation solaire (°)", color: "#9a9ea8" },
            ticks: { color: "#9a9ea8" },
            grid: { color: "#23272f" },
          },
        },
        plugins: {
          legend: { labels: { color: "#e9e7e0" } },
          tooltip: {
            callbacks: {
              label: (item) =>
                item.dataset.label + " : " + item.parsed.y.toFixed(1) + "° d'élévation",
              title: (items) => "Azimut " + items[0].parsed.x.toFixed(0) + "°",
            },
          },
        },
      },
    });

    renderMaskWarning(mask, { ete: seriesEte, hiver: seriesHiver, equinoxe: seriesEquinoxe });
  }

  /** Hauteur d'obstacle à un azimut donné (voir js/horizon-mask.js). */
  function maskElevationAt(mask, azimuthSouth) {
    return window.HorizonMask.elevationAt(mask, azimuthSouth);
  }

  /** Détecte, pour chaque saison, si la trajectoire solaire passe sous le masque d'horizon. */
  function renderMaskWarning(mask, seriesBySeason) {
    const el = document.getElementById("loc-mask-warning");
    if (mask.length === 0) {
      el.style.display = "none";
      return;
    }

    const seasonLabels = { ete: "été", hiver: "hiver", equinoxe: "équinoxe" };
    const affected = [];

    Object.keys(seriesBySeason).forEach((season) => {
      // pour chaque point de la trajectoire, masqué si sous la hauteur
      // de l'obstacle QUI COUVRE CET AZIMUT PRÉCIS (pas d'extrapolation
      // au-delà des plages définies)
      const points = seriesBySeason[season].filter((p) => p.y < maskElevationAt(mask, p.x));
      if (points.length > 0) {
        const minAz = Math.min(...points.map((p) => p.x));
        const maxAz = Math.max(...points.map((p) => p.x));
        affected.push(
          seasonLabels[season] +
            " (soleil masqué quand son azimut est entre " +
            minAz.toFixed(0) +
            "° et " +
            maxAz.toFixed(0) +
            "°)"
        );
      }
    });

    if (affected.length > 0) {
      el.textContent = "Ombre probable : " + affected.join(" ; ") + ".";
      el.style.color = "var(--accent-danger)";
      el.style.display = "block";
    } else {
      el.textContent = "Aucun conflit détecté entre la trajectoire solaire et les obstacles renseignés.";
      el.style.color = "var(--accent-battery)";
      el.style.display = "block";
    }
  }

  // ------------------------------------------------------------------
  // Sélecteur et actions sur les profils de masque
  // ------------------------------------------------------------------
  function renderProfileSelect() {
    const select = document.getElementById("mask-profile-select");
    const loc = window.AppState.get().location;
    select.innerHTML = "";
    loc.horizonMaskProfiles.forEach((p) => {
      const opt = document.createElement("option");
      opt.value = p.id;
      opt.textContent = p.name;
      select.appendChild(opt);
    });
    select.value = loc.activeHorizonMaskProfileId;
  }

  function bindProfileButtons() {
    window.bindOnce(document.getElementById("mask-profile-select"), "change", function (e) {
      const s = window.AppState.get();
      s.location.activeHorizonMaskProfileId = e.target.value;
      window.AppState.set("location", s.location);
      renderMaskTable();
      refreshAzimuthChartIfReady();
    });

    window.bindOnce(document.getElementById("mask-profile-new"), "click", function () {
      const name = window.prompt("Nom du nouveau profil (ex. \"Bas de toiture\") :", "Nouveau profil");
      if (!name) return;
      const s = window.AppState.get();
      const id = "profile-" + Date.now().toString(36);
      s.location.horizonMaskProfiles.push({ id, name, mask: [] });
      s.location.activeHorizonMaskProfileId = id;
      window.AppState.set("location", s.location);
      refreshMaskUI();
    });

    window.bindOnce(document.getElementById("mask-profile-duplicate"), "click", function () {
      const s = window.AppState.get();
      const current = getActiveProfile();
      const name = window.prompt("Nom du profil dupliqué :", current.name + " (copie)");
      if (!name) return;
      const id = "profile-" + Date.now().toString(36);
      s.location.horizonMaskProfiles.push({
        id,
        name,
        mask: current.mask.map((m) => Object.assign({}, m)),
      });
      s.location.activeHorizonMaskProfileId = id;
      window.AppState.set("location", s.location);
      refreshMaskUI();
    });

    window.bindOnce(document.getElementById("mask-profile-rename"), "click", function () {
      const s = window.AppState.get();
      const current = getActiveProfile();
      const name = window.prompt("Nouveau nom du profil :", current.name);
      if (!name) return;
      current.name = name;
      window.AppState.set("location", s.location);
      renderProfileSelect();
    });

    window.bindOnce(document.getElementById("mask-profile-delete"), "click", function () {
      const s = window.AppState.get();
      if (s.location.horizonMaskProfiles.length <= 1) {
        alert("Impossible de supprimer le dernier profil restant.");
        return;
      }
      const current = getActiveProfile();
      if (!confirm('Supprimer le profil "' + current.name + '" ? Cette action est irréversible.')) {
        return;
      }
      s.location.horizonMaskProfiles = s.location.horizonMaskProfiles.filter(
        (p) => p.id !== current.id
      );
      s.location.activeHorizonMaskProfileId = s.location.horizonMaskProfiles[0].id;
      window.AppState.set("location", s.location);
      refreshMaskUI();
    });
  }

  // ------------------------------------------------------------------
  // Calculette : correction de l'angle mesuré selon la hauteur d'observation
  // ------------------------------------------------------------------
  function bindCalculator() {
    ["calc-measure-height", "calc-distance", "calc-measured-elevation", "calc-desired-height"].forEach(
      (id) => window.bindOnce(document.getElementById(id), "input", updateCalculator)
    );
    window.bindOnce(document.getElementById("calc-mode-horizontal"), "change", updateCalculator);
    window.bindOnce(document.getElementById("calc-mode-slant"), "change", updateCalculator);
    updateCalculator();
  }

  function updateCalculator() {
    const measureHeight = parseFloat(document.getElementById("calc-measure-height").value);
    const measuredDistance = parseFloat(document.getElementById("calc-distance").value);
    const measuredElevation = parseFloat(document.getElementById("calc-measured-elevation").value);
    const desiredHeight = parseFloat(document.getElementById("calc-desired-height").value);
    const slantMode = document.getElementById("calc-mode-slant").checked;

    const outHorizontal = document.getElementById("calc-horizontal-distance");
    const outHeight = document.getElementById("calc-obstacle-height");
    const outElevation = document.getElementById("calc-new-elevation");

    if (
      [measureHeight, measuredDistance, measuredElevation, desiredHeight].some(Number.isNaN) ||
      measuredDistance <= 0
    ) {
      outHorizontal.textContent = "—";
      outHeight.textContent = "—";
      outElevation.textContent = "—";
      return;
    }

    const elevationRad = (measuredElevation * Math.PI) / 180;
    // si la distance mesurée est à vol d'oiseau (hypoténuse), on la
    // projette au sol (côté adjacent) avant de l'utiliser dans le calcul
    const horizontalDistance = slantMode ? measuredDistance * Math.cos(elevationRad) : measuredDistance;

    const obstacleHeight = measureHeight + horizontalDistance * Math.tan(elevationRad);
    const newElevation = (Math.atan2(obstacleHeight - desiredHeight, horizontalDistance) * 180) / Math.PI;

    outHorizontal.textContent = horizontalDistance.toFixed(1);
    outHeight.textContent = obstacleHeight.toFixed(1);
    outElevation.textContent = newElevation.toFixed(1);
  }

  // ------------------------------------------------------------------
  // Table du masque d'horizon (limites d'exposition Est/Ouest)
  // ------------------------------------------------------------------
  function renderMaskTable() {
    const tbody = document.getElementById("mask-table-body");
    tbody.innerHTML = "";
    const mask = getActiveMask();

    mask.forEach((m, index) => {
      const tr = document.createElement("tr");
      tr.innerHTML =
        '<td><input type="number" step="1" min="-180" max="180" data-idx="' +
        index +
        '" data-field="azimuthStart" value="' +
        m.azimuthStart +
        '"></td>' +
        '<td><input type="number" step="1" min="-180" max="180" data-idx="' +
        index +
        '" data-field="azimuthEnd" value="' +
        m.azimuthEnd +
        '"></td>' +
        '<td><input type="number" step="1" min="0" max="90" data-idx="' +
        index +
        '" data-field="elevationDeg" value="' +
        m.elevationDeg +
        '"></td>' +
        '<td><button class="btn btn--sm btn--ghost" data-remove="' +
        index +
        '">✕</button></td>';
      tbody.appendChild(tr);
    });

    tbody.querySelectorAll("input").forEach((input) => {
      input.addEventListener("change", function () {
        const idx = parseInt(input.dataset.idx, 10);
        const field = input.dataset.field;
        const currentMask = getActiveMask();
        currentMask[idx][field] = parseFloat(input.value) || 0;
        setActiveMask(currentMask);
        refreshAzimuthChartIfReady();
      });
    });

    tbody.querySelectorAll("[data-remove]").forEach((btn) => {
      btn.addEventListener("click", function () {
        const idx = parseInt(btn.dataset.remove, 10);
        const currentMask = getActiveMask();
        currentMask.splice(idx, 1);
        setActiveMask(currentMask);
        renderMaskTable();
        refreshAzimuthChartIfReady();
      });
    });
  }

  function bindMaskAddRow() {
    window.bindOnce(document.getElementById("mask-add-row"), "click", function () {
      const currentMask = getActiveMask();
      currentMask.push({ azimuthStart: -10, azimuthEnd: 10, elevationDeg: 15 });
      setActiveMask(currentMask);
      renderMaskTable();
      refreshAzimuthChartIfReady();
    });
  }

  function refreshAzimuthChartIfReady() {
    const loc = window.AppState.get().location;
    if (loc.lat !== null && loc.lng !== null) {
      renderAzimuthChart(loc.lat, loc.lng, loc.timezoneOffset);
      renderElevationChart(loc.lat, loc.lng, loc.timezoneOffset);
    }
  }

  // ------------------------------------------------------------------
  // Tarif de revente
  // ------------------------------------------------------------------
  function bindSellTariff() {
    const input = document.getElementById("loc-sell-tariff");
    input.value = window.AppState.get().location.sellTariffPerKwh;
    window.bindOnce(input, "change", function () {
      const s = window.AppState.get();
      s.location.sellTariffPerKwh = parseFloat(input.value) || 0;
      window.AppState.set("location", s.location);
    });
  }

  // ------------------------------------------------------------------
  // PVGIS (irradiance mensuelle réelle)
  //
  // Important : PVGIS refuse explicitement les requêtes AJAX
  // cross-origin depuis un navigateur (politique CORS assumée et
  // documentée par le JRC — ce n'est pas un problème de réseau, un
  // fetch() direct ne fonctionnera JAMAIS, quel que soit le
  // navigateur). Le contournement : on ouvre l'URL PVGIS dans un
  // nouvel onglet (simple navigation, pas un appel AJAX -> autorisé),
  // l'utilisateur copie le JSON affiché, et le colle ici. Un peu
  // moins fluide qu'un bouton magique, mais 100% fiable et ne
  // nécessite aucun serveur relais.
  // ------------------------------------------------------------------
  function bindPvgisButton() {
    window.bindOnce(document.getElementById("loc-open-pvgis"), "click", function () {
      const s = window.AppState.get();
      if (s.location.lat === null) {
        alert("Renseignez d'abord une localisation.");
        return;
      }
      const url =
        "https://re.jrc.ec.europa.eu/api/v5_2/MRcalc?lat=" +
        s.location.lat +
        "&lon=" +
        s.location.lng +
        "&horirrad=1&d2g=1&outputformat=json";
      window.open(url, "_blank");
      document.getElementById("loc-pvgis-status").textContent =
        "Un nouvel onglet s'est ouvert avec les données PVGIS brutes : sélectionnez tout (Ctrl/Cmd+A), copiez, puis collez ci-dessous.";
    });

    window.bindOnce(document.getElementById("loc-pvgis-import"), "click", function () {
      const raw = document.getElementById("loc-pvgis-paste").value.trim();
      const statusEl = document.getElementById("loc-pvgis-status");
      if (!raw) {
        statusEl.textContent = "Collez d'abord le contenu JSON récupéré depuis PVGIS.";
        return;
      }
      try {
        const json = JSON.parse(raw);
        const s = window.AppState.get();
        s.location.pvgisCache = json;
        window.AppState.set("location", s.location);
        statusEl.textContent = "";
        document.getElementById("loc-pvgis-paste").value = "";
        renderPvgisCacheStatus();
      } catch (err) {
        statusEl.textContent =
          "Contenu invalide : ce n'est pas du JSON PVGIS valide (vérifiez que vous avez bien tout copié).";
      }
    });

    renderPvgisCacheStatus(); // affiche l'état déjà en cache au chargement de l'onglet
  }

  /**
   * Affiche un état PERSISTANT (pas un message qui disparaît) du
   * cache PVGIS : présent ou non, avec un aperçu du contenu, pour
   * lever toute ambiguïté sur le succès de l'import.
   */
  function renderPvgisCacheStatus() {
    const el = document.getElementById("loc-pvgis-summary");
    const cache = window.AppState.get().location.pvgisCache;

    if (!cache) {
      el.innerHTML =
        '<p class="field__hint">Aucune donnée PVGIS en cache pour l\'instant.</p>';
      return;
    }

    let raw;
    try {
      raw = JSON.stringify(cache, null, 2);
    } catch (e) {
      raw = String(cache);
    }
    const truncated = raw.length > 500 ? raw.slice(0, 500) + "\n…" : raw;

    el.innerHTML =
      '<p class="field__hint" style="color:var(--accent-battery);">✓ Données PVGIS en cache dans le projet (' +
      Math.round(raw.length / 1024) +
      ' ko). Aperçu :</p>' +
      '<pre style="background:var(--bg); border:1px solid var(--border); border-radius:var(--radius); ' +
      'padding:8px 10px; font-size:11px; color:var(--text-dim); max-height:160px; overflow:auto; ' +
      'font-family:var(--font-data); white-space:pre-wrap;">' +
      escapeHtml(truncated) +
      "</pre>" +
      '<button id="loc-pvgis-clear" class="btn btn--sm btn--ghost" style="margin-top:6px;">Effacer le cache PVGIS</button>';

    document.getElementById("loc-pvgis-clear").addEventListener("click", function () {
      const s = window.AppState.get();
      s.location.pvgisCache = null;
      window.AppState.set("location", s.location);
      renderPvgisCacheStatus();
    });
  }

  // ------------------------------------------------------------------
  // PVGIS (irradiance horaire réelle, "Hourly data" / seriescalc)
  //
  // Même contournement CORS que ci-dessus pour ouvrir la requête, mais
  // usage différent : ce volume de données (une valeur par heure sur
  // potentiellement plusieurs années) n'est pas copiable/collable de
  // façon fiable dans un textarea. PVGIS le propose donc en fichier
  // téléchargeable (CSV) : on ouvre l'URL "seriescalc" dans un nouvel
  // onglet, et l'utilisateur importe ensuite le fichier obtenu via un
  // sélecteur classique.
  // ------------------------------------------------------------------
  let pendingHourlyByYear = null; // { année: [{month, day, hours:[24 W]}] } en attente de choix d'année

  function bindPvgisHourlyButtons() {
    window.bindOnce(document.getElementById("loc-open-pvgis-hourly"), "click", function () {
      const s = window.AppState.get();
      if (s.location.lat === null) {
        alert("Renseignez d'abord une localisation.");
        return;
      }
      const url =
        "https://re.jrc.ec.europa.eu/api/v5_2/seriescalc?lat=" +
        s.location.lat +
        "&lon=" +
        s.location.lng +
        "&pvcalculation=1&components=1&outputformat=csv";
      window.open(url, "_blank");
      document.getElementById("loc-pvgis-hourly-status").textContent =
        "Un nouvel onglet s'est ouvert : le fichier CSV se télécharge (ou s'affiche en texte brut selon le navigateur — dans ce cas, enregistrez-le avec Ctrl/Cmd+S). Importez-le ensuite ci-dessous.";
    });

    window.bindOnce(document.getElementById("loc-pvgis-hourly-import"), "click", function () {
      document.getElementById("loc-pvgis-hourly-input").click();
    });

    window.bindOnce(document.getElementById("loc-pvgis-hourly-input"), "change", function (e) {
      const file = e.target.files[0];
      e.target.value = ""; // permet de réimporter le même fichier deux fois de suite
      if (!file) return;
      const statusEl = document.getElementById("loc-pvgis-hourly-status");
      const reader = new FileReader();
      reader.onload = function (ev) {
        try {
          const parsed = parsePvgisHourlyCsv(ev.target.result);
          const years = Object.keys(parsed.byYear).map(Number).sort(function (a, b) { return a - b; });
          if (years.length === 0) {
            statusEl.textContent = "Aucune ligne de données exploitable trouvée dans ce fichier.";
          } else if (years.length === 1) {
            applyPvgisHourlyYear(parsed.byYear[years[0]], years[0]);
            statusEl.textContent = "";
          } else {
            pendingHourlyByYear = parsed.byYear;
            showYearPicker(years);
            statusEl.textContent = "Plusieurs années détectées : choisissez celle à utiliser ci-dessous.";
          }
        } catch (err) {
          statusEl.textContent =
            "Fichier invalide : en-tête \"time,P,...\" introuvable (vérifiez qu'il s'agit bien d'un export PVGIS \"Hourly data\" avec le calcul PV activé).";
          console.warn(err);
        }
      };
      reader.onerror = function () {
        statusEl.textContent = "Impossible de lire ce fichier.";
      };
      reader.readAsText(file);
    });

    window.bindOnce(document.getElementById("loc-pvgis-hourly-year-confirm"), "click", function () {
      const select = document.getElementById("loc-pvgis-hourly-year-select");
      const year = parseInt(select.value, 10);
      if (pendingHourlyByYear && pendingHourlyByYear[year]) {
        applyPvgisHourlyYear(pendingHourlyByYear[year], year);
        pendingHourlyByYear = null;
        document.getElementById("loc-pvgis-hourly-year-picker").style.display = "none";
        document.getElementById("loc-pvgis-hourly-status").textContent = "";
      }
    });

    renderPvgisHourlyCacheStatus(); // affiche l'état déjà en cache au chargement de l'onglet
  }

  function showYearPicker(years) {
    const picker = document.getElementById("loc-pvgis-hourly-year-picker");
    const select = document.getElementById("loc-pvgis-hourly-year-select");
    select.innerHTML = years.map(function (y) { return "<option value=\"" + y + "\">" + y + "</option>"; }).join("");
    picker.style.display = "flex";
  }

  /**
   * Parse le CSV "Hourly data" de PVGIS (colonnes time, P, Gb(i), Gd(i),
   * Gr(i), H_sun, T2m, WS10m, Int, précédées et suivies de lignes de
   * métadonnées en texte libre). La ligne d'en-tête est repérée par son
   * contenu (elle commence par "time,") plutôt que par un numéro de
   * ligne fixe : le nombre de lignes de métadonnées varie selon les
   * options choisies sur PVGIS, alors que le nom des colonnes est
   * stable. On s'arrête à la première ligne de données mal formée (fin
   * du tableau, début du texte de licence en pied de fichier).
   *
   * Seules les colonnes `time` et `P` (puissance PV, W) sont retenues,
   * comme demandé — Gb(i)/Gd(i)/Gr(i)/H_sun/T2m/WS10m/Int sont ignorées.
   *
   * time est au format PVGIS "AAAAMMJJ:HHMM" (ex: "20200101:0010") ;
   * seuls l'année/le mois/le jour/l'heure sont utilisés, les minutes
   * (toujours ":10" chez PVGIS, convention interne à leur horodatage)
   * sont ignorées.
   *
   * Retourne { byYear: { [année]: [{ month, day, hours: [24 valeurs W, index 0 = 0h] }] } }.
   */
  function parsePvgisHourlyCsv(text) {
    const lines = text.split(/\r?\n/);
    let headerIdx = -1;
    let timeCol = -1;
    let powerCol = -1;
    for (let i = 0; i < lines.length; i++) {
      const cells = lines[i].split(",");
      if (cells[0].trim().toLowerCase() === "time") {
        timeCol = cells.findIndex(function (c) { return c.trim().toLowerCase() === "time"; });
        powerCol = cells.findIndex(function (c) { return c.trim() === "P"; });
        headerIdx = i;
        break;
      }
    }
    if (headerIdx === -1 || timeCol === -1 || powerCol === -1) {
      throw new Error("en-tête \"time,P,...\" introuvable");
    }

    // clé "année-mois-jour" -> { year, month, day, hours: [24 puissances W] }
    const byDate = {};
    const timeRe = /^(\d{4})(\d{2})(\d{2}):(\d{2})/;

    for (let i = headerIdx + 1; i < lines.length; i++) {
      const line = lines[i];
      if (!line || !line.trim()) continue;
      const cells = line.split(",");
      const m = timeRe.exec((cells[timeCol] || "").trim());
      if (!m) break; // fin du tableau (pied de page PVGIS)
      const year = parseInt(m[1], 10);
      const month = parseInt(m[2], 10);
      const day = parseInt(m[3], 10);
      const hour = parseInt(m[4], 10);
      const powerW = parseFloat(cells[powerCol]);
      if (hour < 0 || hour > 23 || isNaN(powerW)) continue;
      const key = year + "-" + month + "-" + day;
      if (!byDate[key]) byDate[key] = { year: year, month: month, day: day, hours: new Array(24) };
      byDate[key].hours[hour] = powerW;
    }

    const byYear = {};
    Object.keys(byDate).forEach(function (key) {
      const entry = byDate[key];
      if (!byYear[entry.year]) byYear[entry.year] = [];
      byYear[entry.year].push({ month: entry.month, day: entry.day, hours: entry.hours });
    });
    return { byYear: byYear };
  }

  /**
   * Interpole les 24 valeurs horaires d'une journée en 96 valeurs à pas
   * de 15 min (index 0 = 00h00, index 95 = 23h45), par interpolation
   * linéaire entre heures consécutives. Le dernier quart d'heure de la
   * journée (23h15-23h45) n'a pas de point suivant dans la même
   * journée : on prolonge à plat la valeur de 23h plutôt que d'aller
   * chercher le lendemain (les deux jours ne sont pas forcément
   * contigus dans le fichier importé).
   */
  function interpolateTo15Min(hours) {
    const values = new Array(96);
    for (let h = 0; h < 24; h++) {
      const v0 = typeof hours[h] === "number" ? hours[h] : 0;
      const v1 = h + 1 < 24 && typeof hours[h + 1] === "number" ? hours[h + 1] : v0;
      for (let q = 0; q < 4; q++) {
        values[h * 4 + q] = v0 + (v1 - v0) * (q / 4);
      }
    }
    return values;
  }

  function applyPvgisHourlyYear(days, year) {
    const processedDays = days
      .slice()
      .sort(function (a, b) { return a.month - b.month || a.day - b.day; })
      .map(function (d) { return { month: d.month, day: d.day, values15min: interpolateTo15Min(d.hours) }; });
    const s = window.AppState.get();
    s.location.pvgisHourlyCache = { year: year, days: processedDays };
    window.AppState.set("location", s.location);
    renderPvgisHourlyCacheStatus();
  }

  /** Même rôle que renderPvgisCacheStatus, pour le cache horaire. */
  function renderPvgisHourlyCacheStatus() {
    const el = document.getElementById("loc-pvgis-hourly-summary");
    const cache = window.AppState.get().location.pvgisHourlyCache;

    if (!cache) {
      el.innerHTML = "<p class=\"field__hint\">Aucune donnée horaire PVGIS en cache pour l'instant.</p>";
      return;
    }

    el.innerHTML =
      "<p class=\"field__hint\" style=\"color:var(--accent-battery);\">✓ Données horaires PVGIS en cache pour l'année " +
      cache.year + " (" + cache.days.length + " jour(s), pas 15 min).</p>" +
      "<button id=\"loc-pvgis-hourly-clear\" class=\"btn btn--sm btn--ghost\" style=\"margin-top:6px;\">Effacer le cache horaire PVGIS</button>";

    document.getElementById("loc-pvgis-hourly-clear").addEventListener("click", function () {
      const s = window.AppState.get();
      s.location.pvgisHourlyCache = null;
      window.AppState.set("location", s.location);
      renderPvgisHourlyCacheStatus();
    });
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  // ------------------------------------------------------------------
  // Tarifs électriques (plages horaires, structure extensible)
  // ------------------------------------------------------------------
  function renderTariffTable() {
    const tbody = document.getElementById("tariff-table-body");
    tbody.innerHTML = "";
    const tariffs = window.AppState.get().location.tariffs;

    tariffs.forEach((t, index) => {
      const tr = document.createElement("tr");
      tr.innerHTML =
        '<td><input type="text" data-idx="' +
        index +
        '" data-field="label" value="' +
        escapeAttr(t.label) +
        '"></td>' +
        '<td><input type="number" step="0.5" min="0" max="24" data-idx="' +
        index +
        '" data-field="startHour" value="' +
        t.startHour +
        '"></td>' +
        '<td><input type="number" step="0.5" min="0" max="24" data-idx="' +
        index +
        '" data-field="endHour" value="' +
        t.endHour +
        '"></td>' +
        '<td><input type="number" step="0.0001" min="0" data-idx="' +
        index +
        '" data-field="pricePerKwh" value="' +
        t.pricePerKwh +
        '"></td>' +
        '<td><button class="btn btn--sm btn--ghost" data-remove="' +
        index +
        '">✕</button></td>';
      tbody.appendChild(tr);
    });

    tbody.querySelectorAll("input").forEach((input) => {
      input.addEventListener("change", function () {
        const idx = parseInt(input.dataset.idx, 10);
        const field = input.dataset.field;
        const s = window.AppState.get();
        const value = field === "label" ? input.value : parseFloat(input.value);
        s.location.tariffs[idx][field] = value;
        window.AppState.set("location", s.location);
      });
    });

    tbody.querySelectorAll("[data-remove]").forEach((btn) => {
      btn.addEventListener("click", function () {
        const idx = parseInt(btn.dataset.remove, 10);
        const s = window.AppState.get();
        s.location.tariffs.splice(idx, 1);
        window.AppState.set("location", s.location);
        renderTariffTable();
      });
    });
  }

  function bindTariffAddRow() {
    window.bindOnce(document.getElementById("tariff-add-row"), "click", function () {
      const s = window.AppState.get();
      s.location.tariffs.push({
        id: "tariff-" + Date.now(),
        label: "Nouvelle plage",
        startHour: 0,
        endHour: 24,
        pricePerKwh: 0.25,
      });
      window.AppState.set("location", s.location);
      renderTariffTable();
    });
  }

  function escapeAttr(str) {
    return String(str).replace(/"/g, "&quot;");
  }

  return { init };
})();
