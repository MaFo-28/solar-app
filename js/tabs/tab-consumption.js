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
    renderCalendar();
    renderCalendarCosts();
  }

  function init() {
    renderProfileSelect();
    bindProfileButtons();
    renderSegmentTable();
    bindAddSegment();
    computeAndRenderCost();
    renderCalendar();
    renderCalendarCosts();
    bindTariffChangeListener();
  }

  /**
   * Les coûts (du jour comme de l'année) dépendent des tarifs édités
   * dans l'onglet Localisation : sans ce réabonnement, ils resteraient
   * figés sur les tarifs connus au premier affichage de cet onglet.
   */
  let tariffListenerBound = false;
  function bindTariffChangeListener() {
    if (tariffListenerBound) return;
    tariffListenerBound = true;
    window.AppState.onChange(function (path) {
      if (path === "location") {
        computeAndRenderCost();
        renderCalendarCosts();
      }
    });
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
      renderCalendar(); // le nom apparaît aussi dans les lignes du calendrier
    });

    window.bindOnce(document.getElementById("consumption-profile-delete"), "click", function () {
      const s = window.AppState.get();
      if (s.consumption.profiles.length <= 1) {
        alert("Impossible de supprimer le dernier profil restant.");
        return;
      }
      const current = getActiveProfile();
      const usedDays = s.consumption.calendar.reduce(
        (sum, lines) => sum + lines.filter((l) => l.profileId === current.id).reduce((n, l) => n + (l.days || 0), 0),
        0
      );
      const extra = usedDays > 0
        ? " Il est utilisé sur " + usedDays + " jour(s) du calendrier : ces lignes seront retirées."
        : "";
      if (!confirm('Supprimer le profil "' + current.name + '" ?' + extra + " Cette action est irréversible.")) {
        return;
      }
      s.consumption.profiles = s.consumption.profiles.filter((p) => p.id !== current.id);
      s.consumption.activeProfileId = s.consumption.profiles[0].id;
      // sinon le calendrier garderait des lignes fantômes qui fausseraient
      // le compte de jours du mois sans être visibles
      s.consumption.calendar = s.consumption.calendar.map((lines) =>
        lines.filter((l) => l.profileId !== current.id)
      );
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
  // Calendrier de consommation : répartition des profils journaliers
  // sur les 12 mois de l'année. Aucune règle sur les jours de la
  // semaine — l'utilisateur choisit librement quels profils, et
  // combien de jours chacun, dans chaque mois.
  // ------------------------------------------------------------------
  function getCalendar() {
    return window.AppState.get().consumption.calendar;
  }

  function setCalendar(calendar) {
    const s = window.AppState.get();
    s.consumption.calendar = calendar;
    window.AppState.set("consumption", s.consumption);
  }

  function renderCalendar() {
    const container = document.getElementById("consumption-calendar-body");
    const U = window.ConsumptionUtils;
    const profiles = window.AppState.get().consumption.profiles || [];
    const calendar = getCalendar();
    container.innerHTML = "";

    calendar.forEach((lines, monthIndex) => {
      const expected = U.DAYS_IN_MONTH[monthIndex];
      const assigned = U.monthAssignedDays(lines);

      const block = document.createElement("div");
      block.className = "calendar-month";
      block.innerHTML =
        '<div class="calendar-month__header">' +
        '<h3 class="calendar-month__name">' + U.MONTH_NAMES[monthIndex] + "</h3>" +
        '<span class="calendar-month__count' + (assigned === expected ? "" : " is-invalid") + '">' +
        assigned + " / " + expected + " j</span>" +
        '<button class="btn btn--sm btn--ghost" data-add-line="' + monthIndex + '">+ Ligne</button>' +
        "</div>";

      if (lines.length === 0) {
        const empty = document.createElement("p");
        empty.className = "calendar-month__empty";
        empty.textContent = "Aucun profil réparti sur ce mois.";
        block.appendChild(empty);
      } else {
        const table = document.createElement("table");
        table.className = "data-table";
        const tbody = document.createElement("tbody");
        lines.forEach((line, idx) => {
          const options = profiles
            .map((p) =>
              '<option value="' + p.id + '"' +
              (p.id === line.profileId ? " selected" : "") + ">" +
              escapeHtml(p.name) + "</option>"
            )
            .join("");
          const tr = document.createElement("tr");
          tr.innerHTML =
            '<td><select data-month="' + monthIndex + '" data-idx="' + idx + '">' + options + "</select></td>" +
            '<td style="width:84px;"><input type="number" min="0" max="31" step="1" data-month="' +
            monthIndex + '" data-idx="' + idx + '" value="' + (line.days || 0) + '"></td>' +
            '<td style="width:36px;"><button class="btn btn--sm btn--ghost" data-remove-month="' +
            monthIndex + '" data-remove-idx="' + idx + '">✕</button></td>';
          tbody.appendChild(tr);
        });
        table.appendChild(tbody);
        block.appendChild(table);
      }

      container.appendChild(block);
    });

    bindCalendarEvents(container);
  }

  function bindCalendarEvents(container) {
    container.querySelectorAll("select[data-month]").forEach((select) => {
      select.addEventListener("change", function () {
        const calendar = getCalendar();
        calendar[+select.dataset.month][+select.dataset.idx].profileId = select.value;
        setCalendar(calendar);
        renderCalendarCosts();
      });
    });

    container.querySelectorAll("input[data-month]").forEach((input) => {
      input.addEventListener("change", function () {
        const calendar = getCalendar();
        calendar[+input.dataset.month][+input.dataset.idx].days = Math.max(0, parseInt(input.value, 10) || 0);
        setCalendar(calendar);
        renderCalendar(); // le compteur de jours du mois doit suivre
        renderCalendarCosts();
      });
    });

    container.querySelectorAll("[data-add-line]").forEach((btn) => {
      btn.addEventListener("click", function () {
        const profiles = window.AppState.get().consumption.profiles || [];
        if (profiles.length === 0) return;
        const monthIndex = +btn.dataset.addLine;
        const calendar = getCalendar();
        const U = window.ConsumptionUtils;
        // pré-rempli avec les jours qu'il reste à couvrir sur ce mois,
        // le cas le plus fréquent étant de compléter le mois d'un coup
        const remaining = Math.max(0, U.DAYS_IN_MONTH[monthIndex] - U.monthAssignedDays(calendar[monthIndex]));
        calendar[monthIndex].push({
          id: "calendar-line-" + Date.now().toString(36),
          profileId: profiles[0].id,
          days: remaining,
        });
        setCalendar(calendar);
        renderCalendar();
        renderCalendarCosts();
      });
    });

    container.querySelectorAll("[data-remove-month]").forEach((btn) => {
      btn.addEventListener("click", function () {
        const calendar = getCalendar();
        calendar[+btn.dataset.removeMonth].splice(+btn.dataset.removeIdx, 1);
        setCalendar(calendar);
        renderCalendar();
        renderCalendarCosts();
      });
    });
  }

  /**
   * Coût de l'année entière, affiché en tête de section : c'est le
   * repère pour ajuster la répartition des jours jusqu'à se rapprocher
   * de la facture réelle.
   */
  function renderCalendarCosts() {
    const s = window.AppState.get();
    const U = window.ConsumptionUtils;
    const totals = U.calendarAnnualCost(s.consumption.calendar, s.consumption.profiles, s.location.tariffs);

    document.getElementById("stat-calendar-cost-hc").textContent = totals.hc.toFixed(2);
    document.getElementById("stat-calendar-cost-hp").textContent = totals.hp.toFixed(2);
    document.getElementById("stat-calendar-cost-total").textContent = totals.total.toFixed(2);

    // Un mois incomplet ne bloque pas la saisie, mais le coût affiché
    // ne couvre alors pas l'année entière : on le dit explicitement.
    const incomplete = [];
    s.consumption.calendar.forEach((lines, monthIndex) => {
      const assigned = U.monthAssignedDays(lines);
      if (assigned !== U.DAYS_IN_MONTH[monthIndex]) {
        incomplete.push(U.MONTH_NAMES[monthIndex] + " (" + assigned + "/" + U.DAYS_IN_MONTH[monthIndex] + ")");
      }
    });

    const warning = document.getElementById("consumption-calendar-warning");
    if (incomplete.length === 0) {
      warning.style.display = "none";
    } else {
      warning.style.display = "block";
      warning.textContent =
        "Le compte de jours ne tombe pas juste sur " + incomplete.length +
        (incomplete.length > 1 ? " mois" : " mois") + " — le coût annuel est donc incomplet : " +
        incomplete.join(", ") + ".";
    }
  }

  function escapeHtml(str) {
    return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  // ------------------------------------------------------------------
  // Calcul (fonctions partagées avec le simulateur de l'onglet
  // Simulation — voir js/consumption-utils.js)
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

    // Même fonction que celle qui alimente le coût annuel du calendrier,
    // pour que les deux affichages ne puissent pas diverger.
    const day = window.ConsumptionUtils.dayCost(segments, tariffs);
    document.getElementById("stat-consumption-kwh").textContent = day.kwh.toFixed(2);
    document.getElementById("stat-consumption-cost").textContent = day.total.toFixed(2);
    document.getElementById("stat-consumption-cost-hc").textContent = day.hc.toFixed(2);
    document.getElementById("stat-consumption-cost-hp").textContent = day.hp.toFixed(2);

    renderChart(computeIntervals(segments, tariffs));
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
