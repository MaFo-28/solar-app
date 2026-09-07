/**
 * battery-simulation.js
 *
 * Simulateur pas-à-pas d'une journée complète. Contrairement à tous
 * les autres calculs de l'appli (indépendants dans le temps), une
 * batterie a un état (son niveau de charge, SoC) qui dépend de tout
 * ce qui s'est passé avant — il faut donc dérouler la journée pas à
 * pas plutôt que calculer chaque instant isolément.
 *
 * Modèle de couplage retenu (important, conditionne tous les calculs
 * de rendement) :
 *  - Si la batterie a une entrée solaire directe (hasSolarInput) ET
 *    qu'aucun onduleur séparé n'est sélectionné :
 *    elle est couplée en DC avec son propre convertisseur intégré
 *    (comme la plupart des produits "tout-en-un" du marché). TOUT le
 *    solaire passe par ce sous-système : vers la batterie via son
 *    rendement de charge, ou directement vers la maison/le réseau via
 *    son "rendement solaire" (solarInputEfficiencyPct).
 *  - Sinon (pas de batterie, ou batterie sans entrée solaire) : le
 *    solaire doit obligatoirement passer par l'onduleur séparé pour
 *    devenir utilisable (maison ou réseau). Sans onduleur dans ce
 *    cas, rien n'est utilisable — d'où la règle de validation.
 */
window.BatterySimulation = (function () {
  "use strict";

  const U = window.ConsumptionUtils;

  function interpolateProduction(points, hour) {
    if (points.length === 0) return 0;
    if (hour <= points[0].hour) return points[0].powerW;
    if (hour >= points[points.length - 1].hour) return points[points.length - 1].powerW;
    for (let i = 1; i < points.length; i++) {
      if (points[i].hour >= hour) {
        const p0 = points[i - 1];
        const p1 = points[i];
        const t = (hour - p0.hour) / (p1.hour - p0.hour);
        return p0.powerW + t * (p1.powerW - p0.powerW);
      }
    }
    return 0;
  }

  function isWithinWindow(hour, start, end) {
    if (start <= end) return hour >= start && hour < end;
    return hour >= start || hour < end;
  }

  /**
   * @param {Object} p
   * @param {number} p.stepMinutes
   * @param {Array}  p.productionPoints - [{hour, powerW}], sortie de PV.dayPowerCurve
   * @param {Array}  p.consumptionSegments - [{startHour, endHour, powerW}]
   * @param {Array}  p.tariffs
   * @param {number} p.sellTariffPerKwh
   * @param {Object|null} p.battery - fiche batterie (ou null si "Aucun")
   * @param {number} p.batteryCount
   * @param {boolean} p.hasInverter - un onduleur séparé est-il sélectionné
   * @param {number} p.inverterEfficiencyPct - rendement de l'onduleur séparé (ignoré si !hasInverter)
   * @param {Object} p.chargeStrategy - {mode:'surplus'|'priority', gridChargeMode:'off'|'hc', maxSocPct}
   * @param {Object} p.dischargeStrategy - {mode:'asap'|'hp'|'schedule', scheduleStartHour, scheduleEndHour, minSocPct}
   * @param {string} p.sellMode - 'sell' | 'zero' | 'free'
   * @param {number} [p.initialSocPct=50]
   */
  function simulateDay(p) {
    const stepHours = p.stepMinutes / 60;
    const battery = p.battery;
    const batteryCount = p.batteryCount || 1;
    const dcCoupled = !!(battery && battery.hasSolarInput) && !p.hasInverter;
	
    const capacityKwh = battery ? battery.capacityKwh * batteryCount : 0;
    const maxChargeW = battery ? battery.chargePowerW * batteryCount : 0;
    const maxDischargeW = battery ? battery.dischargePowerW * batteryCount : 0;
    const chargeEff = battery ? battery.chargeEfficiencyPct / 100 : 1;
    const dischargeEff = battery ? battery.dischargeEfficiencyPct / 100 : 1;
    const solarPassThroughEff = dcCoupled ? battery.solarInputEfficiencyPct / 100 : 1;
    const inverterEff = p.hasInverter ? p.inverterEfficiencyPct / 100 : 0;

    const maxSocKwh = capacityKwh * (p.chargeStrategy.maxSocPct / 100);
    const minSocKwh = capacityKwh * (p.dischargeStrategy.minSocPct / 100);

    let socKwh = capacityKwh * ((p.initialSocPct != null ? p.initialSocPct : 50) / 100);
    socKwh = Math.max(minSocKwh, Math.min(maxSocKwh, socKwh));

    // Rendement effectif du "chemin solaire -> AC" (maison/réseau),
    // hors passage éventuel par la batterie : soit le sous-système DC
    // couplé de la batterie (avec son propre convertisseur), soit
    // l'onduleur séparé, soit aucun chemin possible (0).
    const solarToAcEff = dcCoupled ? solarPassThroughEff : inverterEff;

    const points = [];
    let totalProductionKwh = 0;
    let totalConsumptionKwh = 0;
    let totalImportKwh = 0;
    let totalExportKwh = 0;
    let costHc = 0;
    let costHp = 0;
    let costOther = 0;
    let revenueTotal = 0;

    for (let hour = 0; hour < 24; hour += stepHours) {
      const productionW = interpolateProduction(p.productionPoints, hour);
      const consumptionW = U.powerAtHour(p.consumptionSegments, hour);

      totalProductionKwh += (productionW / 1000) * stepHours;
      totalConsumptionKwh += (consumptionW / 1000) * stepHours;

      const tariff = U.tariffForHour(p.tariffs, hour);
      const tariffCategory = U.classifyTariff(tariff);

      const dischargeAllowedNow = !battery
        ? false
        : p.dischargeStrategy.mode === "asap"
        ? true
        : p.dischargeStrategy.mode === "hp"
        ? tariffCategory === "hp"
        : p.dischargeStrategy.mode === "schedule"
        ? isWithinWindow(hour, p.dischargeStrategy.scheduleStartHour, p.dischargeStrategy.scheduleEndHour)
        : true;

      const availableHeadroomKwh = Math.max(0, maxSocKwh - socKwh);
      const availableEnergyKwh = Math.max(0, socKwh - minSocKwh);
      const headroomPowerW = (availableHeadroomKwh / stepHours) * 1000;
      const storedPowerAvailableW = (availableEnergyKwh / stepHours) * 1000;

      let batteryChargeDcW = 0; // puissance côté batterie (avant rendement de charge)
      let solarToHouseAcW = 0;
      let solarToGridAcW = 0;

      if (battery && p.chargeStrategy.mode === "priority") {
        // Batterie chargée en priorité : le solaire la charge d'abord,
        // le reste seulement va vers la maison/le réseau.
        batteryChargeDcW = Math.min(productionW, maxChargeW, headroomPowerW);
        const remainingSolarW = productionW - batteryChargeDcW;
        const remainingSolarAcW = remainingSolarW * solarToAcEff;
        solarToHouseAcW = Math.min(remainingSolarAcW, consumptionW);
        solarToGridAcW = remainingSolarAcW - solarToHouseAcW;
      } else {
        // Surplus (par défaut) : la maison est couverte en premier.
        // Cas particulier : batterie DC couplée, le "surplus" se
        // calcule après le passage par son convertisseur intégré.
        const productionAcW = productionW * solarToAcEff;
        solarToHouseAcW = Math.min(productionAcW, consumptionW);
        const remainingAcW = productionAcW - solarToHouseAcW;
        if (battery) {
          // on revient en "équivalent DC" pour ne pas compter deux fois
          // le rendement de conversion sur la part rechargée
          const remainingDcW = dcCoupled && solarToAcEff > 0 ? remainingAcW / solarToAcEff : remainingAcW;
          batteryChargeDcW = Math.min(remainingDcW, maxChargeW, headroomPowerW);
          const chargedAsAcEquivalentW = batteryChargeDcW * (dcCoupled ? solarToAcEff : 1);
          solarToGridAcW = remainingAcW - chargedAsAcEquivalentW;
        } else {
          solarToGridAcW = remainingAcW;
        }
      }

      let remainingHouseNeedW = consumptionW - solarToHouseAcW;
      let batteryDischargeAcW = 0;

      if (remainingHouseNeedW > 0 && battery && dischargeAllowedNow) {
        const wantedW = Math.min(remainingHouseNeedW, maxDischargeW, storedPowerAvailableW * dischargeEff);
        batteryDischargeAcW = Math.max(0, wantedW);
        remainingHouseNeedW -= batteryDischargeAcW;
      }

      let gridToBatteryDcW = 0;
      if (battery && p.chargeStrategy.gridChargeMode === "hc" && tariffCategory === "hc") {
        const remainingChargePowerW = Math.max(0, maxChargeW - batteryChargeDcW);
        const remainingHeadroomKwh = Math.max(0, availableHeadroomKwh - (batteryChargeDcW * stepHours) / 1000);
        gridToBatteryDcW = Math.min(remainingChargePowerW, (remainingHeadroomKwh / stepHours) * 1000);
        batteryChargeDcW += gridToBatteryDcW;
      }
      // l'énergie réseau nécessaire pour cette charge dépend du
      // convertisseur emprunté (intégré batterie, ou onduleur séparé
      // en aller-retour si couplage AC)
      const gridToBatteryAcW = dcCoupled ? gridToBatteryDcW : inverterEff > 0 ? gridToBatteryDcW / inverterEff : 0;

      // mise à jour du SoC
      const chargeEnergyIntoSocKwh = ((batteryChargeDcW * stepHours) / 1000) * chargeEff;
      const dischargeEnergyFromSocKwh = dischargeEff > 0 ? ((batteryDischargeAcW * stepHours) / 1000) / dischargeEff : 0;
      socKwh = socKwh + chargeEnergyIntoSocKwh - dischargeEnergyFromSocKwh;
      socKwh = Math.max(minSocKwh, Math.min(maxSocKwh, socKwh));

      let exportedW = p.sellMode === "zero" ? 0 : solarToGridAcW;
      const importedW = Math.max(0, remainingHouseNeedW) + gridToBatteryAcW;

      totalImportKwh += (importedW / 1000) * stepHours;
      totalExportKwh += (exportedW / 1000) * stepHours;

      const importCost = ((importedW / 1000) * stepHours) * (tariff ? tariff.pricePerKwh : 0);
      const exportRevenue = p.sellMode === "sell" ? ((exportedW / 1000) * stepHours) * p.sellTariffPerKwh : 0;
      const netCost = importCost - exportRevenue;

      if (tariffCategory === "hc") costHc += netCost;
      else if (tariffCategory === "hp") costHp += netCost;
      else costOther += netCost;
      revenueTotal += exportRevenue;

      points.push({
        hour,
        productionW,
        consumptionW,
        solarToHouseW: solarToHouseAcW,
        batteryChargeW: batteryChargeDcW,
        batteryDischargeW: batteryDischargeAcW,
        gridImportW: importedW,
        gridExportW: exportedW,
        socPct: capacityKwh > 0 ? (socKwh / capacityKwh) * 100 : 0,
      });
    }

    return {
      points,
      totalProductionKwh,
      totalConsumptionKwh,
      totalImportKwh,
      totalExportKwh,
      costTotal: costHc + costHp + costOther,
      costHc,
      costHp,
      revenueTotal,
    };
  }

  return { simulateDay };
})();
