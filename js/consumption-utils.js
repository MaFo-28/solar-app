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
    "Janvier", "Février", "Mars", "Avril", "Mai", "Juin",
    "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre",
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
  };
})();
