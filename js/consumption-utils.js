/**
 * consumption-utils.js
 *
 * Fonctions pures partagées entre l'onglet Consommation et le
 * simulateur de l'onglet Simulation. Centralisées ici pour ne pas
 * dupliquer la même logique deux fois (comme horizon-mask.js pour
 * les onglets Localisation/Panneaux).
 */
window.ConsumptionUtils = (function () {
  "use strict";

  /**
   * Puissance totale (W) à une heure donnée, toutes les plages qui se
   * chevauchent s'additionnent (contrairement au masque d'horizon qui
   * prend le max — plusieurs appareils peuvent tourner en même temps).
   */
  function powerAtHour(segments, hour) {
    let total = 0;
    (segments || []).forEach((seg) => {
      if (seg.startHour <= seg.endHour) {
        if (hour >= seg.startHour && hour < seg.endHour) total += seg.powerW;
      } else {
        // plage qui traverse minuit (ex: 22h-6h)
        if (hour >= seg.startHour || hour < seg.endHour) total += seg.powerW;
      }
    });
    return total;
  }

  /** Le tarif électrique applicable à une heure donnée. */
  function tariffForHour(tariffs, hour) {
    return (tariffs || []).find((t) => {
      if (t.startHour <= t.endHour) {
        return hour >= t.startHour && hour < t.endHour;
      }
      return hour >= t.startHour || hour < t.endHour;
    });
  }

  /**
   * Classe un tarif en Heures Creuses / Heures Pleines / autre, à
   * partir de son identifiant OU de son libellé (au cas où
   * l'utilisateur aurait renommé la plage sans toucher l'id).
   */
  function classifyTariff(tariff) {
    if (!tariff) return null;
    const id = (tariff.id || "").toLowerCase();
    const label = (tariff.label || "").toLowerCase();
    if (id.includes("hc") || label.includes("creuse")) return "hc";
    if (id.includes("hp") || label.includes("pleine")) return "hp";
    return null;
  }

  /**
   * Points de rupture exacts (là où une plage de consommation OU un
   * tarif commence/finit). Entre deux points de rupture consécutifs,
   * la puissance ET le tarif sont strictement constants.
   */
  function getBreakpoints(segments, tariffs) {
    const points = new Set([0, 24]);
    function addRange(start, end) {
      if (start <= end) {
        points.add(start);
        points.add(end);
      } else {
        points.add(start);
        points.add(24);
        points.add(0);
        points.add(end);
      }
    }
    (segments || []).forEach((seg) => addRange(seg.startHour, seg.endHour));
    (tariffs || []).forEach((t) => addRange(t.startHour, t.endHour));
    return Array.from(points)
      .filter((t) => t >= 0 && t <= 24)
      .sort((a, b) => a - b);
  }

  // ------------------------------------------------------------------
  // Calendrier annuel : répartition des profils journaliers sur les
  // 12 mois. Année non bissextile (365 jours) pour que le coût annuel
  // reste déterministe d'un projet à l'autre.
  // ------------------------------------------------------------------
  const MONTH_NAMES = [
    "Janvier", "Février", "Mars", "Avril", "Mai", "Juin", "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre",
  ];

  const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

  /**
   * Consommation et coût d'UNE journée pour un profil donné, décomposés
   * en Heures Creuses / Heures Pleines. Calcul exact par points de
   * rupture : entre deux points, puissance et tarif sont constants, donc
   * pas d'erreur d'échantillonnage (contrairement à un pas horaire fixe
   * qui raterait une plage de 6h30 à 7h15).
   */
  function dayCost(segments, tariffs) {
    const bps = getBreakpoints(segments, tariffs);
    let kwh = 0;
    let total = 0;
    let hc = 0;
    let hp = 0;
    let hcKwh = 0;
    let hpKwh = 0;
    for (let i = 0; i < bps.length - 1; i++) {
      const t0 = bps[i];
      const t1 = bps[i + 1];
      if (t1 <= t0) continue;
      const powerW = powerAtHour(segments, t0);
      const tariff = tariffForHour(tariffs, t0);
      const intervalKwh = (powerW / 1000) * (t1 - t0);
      const cost = intervalKwh * (tariff ? tariff.pricePerKwh : 0);
      kwh += intervalKwh;
      total += cost;
      const category = classifyTariff(tariff);
      if (category === "hc") { hc += cost; hcKwh += intervalKwh; }
      else if (category === "hp") { hp += cost; hpKwh += intervalKwh; }
    }
    return { kwh, total, hc, hp, hcKwh, hpKwh };
  }

  /**
   * Total annuel d'un calendrier : pour chaque ligne, le coût d'une
   * journée du profil référencé multiplié par son nombre de jours. Le
   * coût journalier de chaque profil n'est calculé qu'une fois (un même
   * profil revient dans plusieurs mois).
   *
   * Les lignes qui référencent un profil supprimé sont ignorées.
   */
  function calendarAnnualCost(calendar, profiles, tariffs) {
    const cache = {};
    const totals = { kwh: 0, total: 0, hc: 0, hp: 0, hcKwh: 0, hpKwh: 0 };
    (calendar || []).forEach((lines) => {
      (lines || []).forEach((line) => {
        const profile = (profiles || []).find((p) => p.id === line.profileId);
        if (!profile) return;
        if (!cache[profile.id]) cache[profile.id] = dayCost(profile.segments, tariffs);
        const per = cache[profile.id];
        const days = line.days || 0;
        totals.kwh += per.kwh * days;
        totals.total += per.total * days;
        totals.hc += per.hc * days;
        totals.hp += per.hp * days;
        totals.hcKwh += per.hcKwh * days;
        totals.hpKwh += per.hpKwh * days;
      });
    });
    return totals;
  }

  /** Somme des jours déjà répartis sur un mois. */
  function monthAssignedDays(lines) {
    return (lines || []).reduce((sum, line) => sum + (line.days || 0), 0);
  }

  /**
   * Moyenne les plages de consommation (puissance constante par plage,
   * bornes arbitraires) en 96 valeurs à pas de 15 min — moyenne pondérée
   * par le temps sur chaque quart d'heure, pas un simple échantillonnage
   * à son début (une plage qui commence à 6h30 ne doit pas être ignorée
   * ou surestimée sur le quart d'heure 6h15-6h30).
   */
  function segmentsToQuarterHourAverages(segments) {
    const bps = getBreakpoints(segments); // tariffs omis : uniquement les bornes des plages
    const values = new Array(96);
    for (let i = 0; i < 96; i++) {
      const t0 = i * 0.25;
      const t1 = t0 + 0.25;
      const marks = [t0].concat(bps.filter((b) => b > t0 && b < t1).sort((a, b) => a - b), [t1]);
      let energy = 0;
      for (let k = 0; k < marks.length - 1; k++) {
        const a = marks[k];
        const b = marks[k + 1];
        if (b <= a) continue;
        energy += powerAtHour(segments, a) * (b - a);
      }
      values[i] = energy / 0.25;
    }
    return values;
  }

  // ------------------------------------------------------------------
  // Fichiers de consommation à pas de 15 min ("heure;puissance_w", 96
  // lignes de 00:00 à 23:45) : format partagé par l'import d'un profil
  // isolé (onglet Consommation) et la vérification d'un répertoire de
  // 365 fichiers journaliers (onglet Bilan financier), pour ne pas
  // dupliquer les règles de rejet entre les deux.
  // ------------------------------------------------------------------
  const QUARTER_HOUR_TIMES = buildQuarterHourTimes();
  const QUARTER_HOUR_NUMBER_RE = /^-?\d+(\.\d+)?$/;

  function buildQuarterHourTimes() {
    const times = [];
    for (let h = 0; h < 24; h++) {
      for (let q = 0; q < 4; q++) {
        times.push(String(h).padStart(2, "0") + ":" + String(q * 15).padStart(2, "0"));
      }
    }
    return times;
  }

  /**
   * Parse et valide un fichier "heure;puissance_w" (1 en-tête + 96
   * lignes, 00:00 à 23:45 par pas de 15 min, valeur = puissance
   * moyenne en W). Retourne { values, errors } : values est le tableau
   * des 96 puissances (W) si tout est conforme, sinon null — dans ce
   * cas errors contient au moins un message précisant la ligne en
   * cause (sans nom de fichier : à l'appelant de le préfixer s'il gère
   * plusieurs fichiers).
   */
  function parseQuarterHourCsv(text) {
    const errors = [];
    let raw = text;
    if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1); // BOM éventuel (export Excel)
    const lines = raw.split(/\r?\n/);
    while (lines.length > 0 && lines[lines.length - 1].trim() === "") lines.pop();

    if (lines.length !== 97) {
      errors.push(lines.length + " ligne(s) trouvée(s), 97 attendues (1 en-tête + 96 lignes de données).");
      return { values: null, errors };
    }
    if (lines[0].trim() !== "heure;puissance_w") {
      errors.push('en-tête invalide ("' + lines[0].trim() + '", attendu "heure;puissance_w").');
      return { values: null, errors };
    }

    const values = new Array(96);
    let ok = true;
    for (let i = 0; i < 96; i++) {
      const cells = lines[i + 1].split(";");
      const lineNo = i + 2;
      if (cells.length !== 2) {
        errors.push("ligne " + lineNo + ' : format invalide ("' + lines[i + 1] + '").');
        ok = false;
        continue;
      }
      const time = cells[0].trim();
      if (time !== QUARTER_HOUR_TIMES[i]) {
        errors.push("ligne " + lineNo + " : heure attendue " + QUARTER_HOUR_TIMES[i] + ", trouvée " + time + ".");
        ok = false;
      }
      const valueStr = cells[1].trim();
      if (!QUARTER_HOUR_NUMBER_RE.test(valueStr)) {
        errors.push("ligne " + lineNo + ' : valeur de puissance invalide ("' + valueStr + '").');
        ok = false;
        continue;
      }
      values[i] = parseFloat(valueStr);
    }
    return { values: ok ? values : null, errors };
  }

  return {
    powerAtHour,
    tariffForHour,
    classifyTariff,
    getBreakpoints,
    MONTH_NAMES,
    DAYS_IN_MONTH,
    dayCost,
    calendarAnnualCost,
    monthAssignedDays,
    segmentsToQuarterHourAverages,
    parseQuarterHourCsv,
  };
})();
