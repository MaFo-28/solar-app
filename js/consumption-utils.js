/**
 * consumption-utils.js
 *
 * Fonctions pures partagées entre l'onglet Consommation et le
 * simulateur de l'onglet Stratégie. Centralisées ici pour ne pas
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

  return { powerAtHour, tariffForHour, classifyTariff, getBreakpoints };
})();
