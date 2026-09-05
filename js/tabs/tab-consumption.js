/**
 * tab-consumption.js
 * Onglet 5 — Consommation.
 *
 * Même principe que le masque d'horizon (onglet Localisation) :
 * plusieurs profils nommés, un seul affiché/édité à la fois, chacun
 * défini par une liste de plages horaires (début, fin, puissance en
 * W) plutôt que 24 cases fixes — plus proche de la façon dont on
 * pense réellement sa consommation (par appareil/usage).
 */
window.TabConsumption = (function () {
  "use strict";

  let consumptionChart = null;

  // ------------------------------------------------------------------
  // Profils : un seul actif/affiché à la fois
  // ------------------------------------------------------------------
  function getActiveProfile() {
    const c = window.AppState.get().consumption;
    return c.profiles.find((p) => p.id === c.activeProfileId) || c.profiles[0];
  }

  function getActiveSegments() {
    const profile = getActiveProfile();
    return profile ? profile.segments : [];
  }

  function setActiveSegments(newSegments) {
    const s = window.AppState.get();
    const profile = s.consumption.profiles.find((p) => p.id === s.consumption.activeProfileId);
    if (profile) profile.segments = newSegments;
    window.AppState.set("consumption", s.consumption);
  }

  function refreshUI() {
    renderProfileSelect();
    renderSegmentTable();
    computeAndRenderCost();
  }

  function init() {
    renderProfileSelect();
    bindProfileButtons();
    renderSegmentTable();
    bindAddSegment();
    computeAndRenderCost();
  }

  // ------------------------------------------------------------------
  // Sélecteur et actions sur les profils
  // ------------------------------------------------------------------
  function renderProfileSelect() {
    const select = document.getElementById("consumption-profile-select");
    const c = window.AppState.get().consumption;
    select.innerHTML = "";
    c.profiles.forEach((p) => {
      const opt = document.createElement("option");
      opt.value = p.id;
      opt.textContent = p.name;
      select.appendChild(opt);
    });
    select.value = c.activeProfileId;
  }

  function bindProfileButtons() {
    window.bindOnce(document.getElementById("consumption-profile-select"), "change", function (e) {
      const s = window.AppState.get();
      s.consumption.activeProfileId = e.target.value;
      window.AppState.set("consumption", s.consumption);
      renderSegmentTable();
      computeAndRenderCost();
    });

    window.bindOnce(document.getElementById("consumption-profile-new"), "click", function () {
      const name = window.prompt('Nom du nouveau profil (ex. "Week-end") :', "Nouveau profil");
      if (!name) return;
      const s = window.AppState.get();
      const id = "consumption-profile-" + Date.now().toString(36);
      s.consumption.profiles.push({ id, name, segments: [] });
      s.consumption.activeProfileId = id;
      window.AppState.set("consumption", s.consumption);
      refreshUI();
    });

    window.bindOnce(document.getElementById("consumption-profile-duplicate"), "click", function () {
      const s = window.AppState.get();
      const current = getActiveProfile();
      const name = window.prompt("Nom du profil dupliqué :", current.name + " (copie)");
      if (!name) return;
      const id = "consumption-profile-" + Date.now().toString(36);
      s.consumption.profiles.push({
        id,
        name,
        segments: current.segments.map((seg) => Object.assign({}, seg)),
      });
      s.consumption.activeProfileId = id;
      window.AppState.set("consumption", s.consumption);
      refreshUI();
    });

    window.bindOnce(document.getElementById("consumption-profile-rename"), "click", function () {
      const s = window.AppState.get();
      const current = getActiveProfile();
      const name = window.prompt("Nouveau nom du profil :", current.name);
      if (!name) return;
      current.name = name;
      window.AppState.set("consumption", s.consumption);
      renderProfileSelect();
    });

    window.bindOnce(document.getElementById("consumption-profile-delete"), "click", function () {
      const s = window.AppState.get();
      if (s.consumption.profiles.length <= 1) {
        alert("Impossible de supprimer le dernier profil restant.");
        return;
      }
      const current = getActiveProfile();
      if (!confirm('Supprimer le profil "' + current.name + '" ? Cette action est irréversible.')) {
        return;
      }
      s.consumption.profiles = s.consumption.profiles.filter((p) => p.id !== current.id);
      s.consumption.activeProfileId = s.consumption.profiles[0].id;
      window.AppState.set("consumption", s.consumption);
      refreshUI();
    });
  }

  // ------------------------------------------------------------------
  // Table des plages horaires (début, fin, puissance)
  // ------------------------------------------------------------------
  function renderSegmentTable() {
    const tbody = document.getElementById("consumption-segment-table-body");
    tbody.innerHTML = "";
    const segments = getActiveSegments();

    segments.forEach((seg, index) => {
      const tr = document.createElement("tr");
      tr.innerHTML =
        '<td><input type="number" step="0.5" min="0" max="24" data-idx="' + index + '" data-field="startHour" value="' + seg.startHour + '"></td>' +
        '<td><input type="number" step="0.5" min="0" max="24" data-idx="' + index + '" data-field="endHour" value="' + seg.endHour + '"></td>' +
        '<td><input type="number" step="10" min="0" data-idx="' + index + '" data-field="powerW" value="' + seg.powerW + '"></td>' +
        '<td><button class="btn btn--sm btn--ghost" data-remove="' + index + '">✕</button></td>';
      tbody.appendChild(tr);
    });

    tbody.querySelectorAll("input").forEach((input) => {
      input.addEventListener("change", function () {
        const idx = parseInt(input.dataset.idx, 10);
        const field = input.dataset.field;
        const segs = getActiveSegments();
        segs[idx][field] = parseFloat(input.value) || 0;
        setActiveSegments(segs);
        computeAndRenderCost();
      });
    });

    tbody.querySelectorAll("[data-remove]").forEach((btn) => {
      btn.addEventListener("click", function () {
        const idx = parseInt(btn.dataset.remove, 10);
        const segs = getActiveSegments();
        segs.splice(idx, 1);
        setActiveSegments(segs);
        renderSegmentTable();
        computeAndRenderCost();
      });
    });
  }

  function bindAddSegment() {
    window.bindOnce(document.getElementById("consumption-add-segment"), "click", function () {
      const segs = getActiveSegments();
      segs.push({ startHour: 8, endHour: 9, powerW: 200 });
      setActiveSegments(segs);
      renderSegmentTable();
      computeAndRenderCost();
    });
  }

  // ------------------------------------------------------------------
  // Calcul (fonctions partagées avec le simulateur de l'onglet
  // Stratégie — voir js/consumption-utils.js)
  // ------------------------------------------------------------------
  function computeIntervals(segments, tariffs) {
    const U = window.ConsumptionUtils;
    const bps = U.getBreakpoints(segments, tariffs);
    const intervals = [];
    for (let i = 0; i < bps.length - 1; i++) {
      const t0 = bps[i];
      const t1 = bps[i + 1];
      if (t1 <= t0) continue;
      const powerW = U.powerAtHour(segments, t0);
      const tariff = U.tariffForHour(tariffs, t0);
      intervals.push({ start: t0, end: t1, powerW, tariff });
    }
    return intervals;
  }

  function computeAndRenderCost() {
    const s = window.AppState.get();
    const segments = getActiveSegments();
    const tariffs = s.location.tariffs;
    const intervals = computeIntervals(segments, tariffs);

    let totalKwh = 0;
    let totalCost = 0;
    let costHc = 0;
    let costHp = 0;
    intervals.forEach((iv) => {
      const kwh = (iv.powerW / 1000) * (iv.end - iv.start);
      const cost = kwh * (iv.tariff ? iv.tariff.pricePerKwh : 0);
      totalKwh += kwh;
      totalCost += cost;
      const category = window.ConsumptionUtils.classifyTariff(iv.tariff);
      if (category === "hc") costHc += cost;
      else if (category === "hp") costHp += cost;
    });

    document.getElementById("stat-consumption-kwh").textContent = totalKwh.toFixed(2);
    document.getElementById("stat-consumption-cost").textContent = totalCost.toFixed(2);
    document.getElementById("stat-consumption-cost-hc").textContent = costHc.toFixed(2);
    document.getElementById("stat-consumption-cost-hp").textContent = costHp.toFixed(2);

    renderChart(intervals);
  }

  function renderChart(intervals) {
    const ctx = document.getElementById("chart-consumption").getContext("2d");
    if (consumptionChart) consumptionChart.destroy();

    // Deux points par intervalle (début et fin, même puissance) : la
    // ligne droite standard entre ces points dessine naturellement le
    // palier horizontal, et le saut vertical se fait tout seul entre
    // la fin d'un intervalle et le début du suivant (même x, y différent)
    // — pas besoin de l'option "stepped" de Chart.js, donc pas
    // d'ambiguïté possible sur le sens du décalage.
    const points = [];
    intervals.forEach((iv) => {
      points.push({ x: iv.start, y: iv.powerW });
      points.push({ x: iv.end, y: iv.powerW });
    });

    consumptionChart = new Chart(ctx, {
      type: "line",
      data: {
        datasets: [
          {
            label: "Consommation (W)",
            data: points,
            borderColor: "#3ec9a7",
            backgroundColor: "rgba(62,201,167,0.25)",
            fill: true,
            tension: 0,
            pointRadius: 0,
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
            min: 0,
            title: { display: true, text: "Puissance (W)", color: "#9a9ea8" },
            ticks: { color: "#9a9ea8" },
            grid: { color: "#23272f" },
          },
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              title: (items) => {
                const h = items[0].parsed.x;
                const hh = Math.floor(h);
                const mm = Math.round((h - hh) * 60);
                return String(hh).padStart(2, "0") + "h" + String(mm).padStart(2, "0");
              },
              label: (item) => Math.round(item.parsed.y) + " W",
            },
          },
        },
      },
    });
  }

  return { init };
})();
