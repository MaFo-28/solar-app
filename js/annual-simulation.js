/**
 * annual-simulation.js
 *
 * Moteur de simulation annuelle (365 jours chaînés, pas 15 min) pour
 * l'onglet Bilan financier, section "Bilan annuel". Calcul pur,
 * séparé du DOM comme pv-production.js et battery-simulation.js.
 *
 * Principe : pour chaque jour réel de l'année (irradiance PVGIS
 * horaire réelle, location.pvgisHourlyCache), on calcule la
 * production potentielle (projetée sur l'installation réelle, avant
 * pertes onduleur/batterie) par la même décomposition beam/diffus/
 * réfléchi que PvProduction.monthlyProductionEstimate, mais appliquée
 * instant par instant plutôt qu'à des moyennes mensuelles. On simule
 * ensuite la journée avec BatterySimulation.simulateDay (déjà validé
 * dans l'onglet Simulation), en chaînant l'état de charge de la
 * batterie d'un jour à l'autre (pas de reset quotidien/mensuel).
 */
window.AnnualSimulation = (function () {
  "use strict";

  const ALBEDO = 0.2;

  /**
   * Décalage UTC (heures) de l'heure locale Europe/Paris pour une date
   * donnée (+1 hiver, +2 été, DST géré nativement par Intl) — nécessaire
   * pour que la géométrie solaire (SolarGeometry.hourAngle) retrouve la
   * même heure locale que celle utilisée pour construire
   * pvgisHourlyCache (voir utcToParis dans tab-location.js, même
   * principe ici en sens inverse : date -> décalage plutôt qu'instant
   * UTC -> date locale).
   */
  function parisUtcOffsetHours(year, month, day) {
    const dt = new Date(Date.UTC(year, month - 1, day, 12));
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "Europe/Paris",
      timeZoneName: "shortOffset",
    }).formatToParts(dt);
    const tzPart = parts.find((p) => p.type === "timeZoneName");
    const m = tzPart && /GMT([+-]\d+)/.exec(tzPart.value);
    return m ? parseInt(m[1], 10) : 1;
  }

  /**
   * Production potentielle (avant pertes onduleur/batterie) d'un jour
   * réel, à pas de 15 min (96 points), à partir de l'irradiance PVGIS
   * réelle horizontale (gb15min = direct, gd15min = diffus) et de la
   * géométrie solaire exacte du jour (élévation/azimut), projetée sur
   * l'orientation/inclinaison des panneaux avec masquage éventuel.
   *
   * Même modèle de transposition que PvProduction.monthlyProductionEstimate
   * (Liu-Jordan : direct via ratio géométrique cosθ/sin(élévation),
   * diffus via (1+cosβ)/2, réfléchi via albédo·(1-cosβ)/2), mais évalué
   * instant par instant plutôt qu'en moyenne mensuelle — le masquage ne
   * s'applique qu'à la composante directe, comme dans ce modèle mensuel.
   */
  function computeDayPotentialProduction(dayHourly, lat, lng, ratedTotalWc, tiltDeg, orientationDeg, mask) {
    const G = window.SolarGeometry;
    const doy = G.dayOfYear(new Date(dayHourly.year, dayHourly.month - 1, dayHourly.day));
    const tz = parisUtcOffsetHours(dayHourly.year, dayHourly.month, dayHourly.day);
    const declination = G.solarDeclination(doy);
    const tiltRad = (tiltDeg * Math.PI) / 180;

    const points = new Array(96);
    let energyWh = 0;

    for (let i = 0; i < 96; i++) {
      const hour = i * 0.25;
      const gb = dayHourly.gb15min[i] || 0;
      const gd = dayHourly.gd15min[i] || 0;
      const ha = G.hourAngle(hour, doy, lng, tz);
      const elevation = G.elevationAngle(lat, declination, ha);

      let totalWm2 = 0;
      if (elevation > 0) {
        const azimuth = G.azimuthAngle(lat, declination, ha, elevation);
        const azSouth = G.azimuthToSouthRelative(azimuth);
        const masked = window.HorizonMask.isMasked(mask, elevation, azSouth);

        let beamWm2 = 0;
        if (!masked) {
          const cosTheta = Math.max(0, G.cosIncidenceAngle(elevation, azSouth, tiltDeg, orientationDeg));
          const sinElevation = Math.sin(elevation * G.DEG2RAD);
          beamWm2 = sinElevation > 0 ? gb * (cosTheta / sinElevation) : 0;
        }
        const diffuseWm2 = gd * ((1 + Math.cos(tiltRad)) / 2);
        const reflectedWm2 = (gb + gd) * ALBEDO * ((1 - Math.cos(tiltRad)) / 2);
        totalWm2 = beamWm2 + diffuseWm2 + reflectedWm2;
      }

      const powerW = ratedTotalWc * (totalWm2 / 1000);
      points[i] = { hour, powerW };
      energyWh += powerW * 0.25;
    }

    return { points, energyKwh: energyWh / 1000 };
  }

  function sumField(arr, field) {
    return arr.reduce((s, d) => s + d[field], 0);
  }

  /**
   * Simule les 365 jours de l'année, chaînés en continu (l'état de
   * charge de la batterie se poursuit d'un jour à l'autre). Le
   * découpage en mois ne sert qu'à l'agrégation des résultats.
   *
   * @param {Object} p
   * @param {Object} p.pvgisHourlyDaysByKey - { "MM-DD": jour de location.pvgisHourlyCache.days }
   * @param {Object} p.consumptionDaysByKey - { "MM-DD": [96 W] }, cf. consumptionDayCache
   * @param {number} p.lat
   * @param {number} p.lng
   * @param {number} p.ratedTotalWc
   * @param {number} p.tiltDeg
   * @param {number} p.orientationDeg
   * @param {Array}  p.mask
   * @param {Object|null} p.battery
   * @param {boolean} p.hasInverter
   * @param {number} p.inverterEfficiencyPct
   * @param {Object} p.chargeStrategy
   * @param {Object} p.dischargeStrategy
   * @param {string} p.sellMode
   * @param {Array}  p.tariffs
   * @param {number} p.sellTariffPerKwh
   * @param {number} [p.initialSocPct=10]
   */
  function simulateYear(p) {
    const U = window.ConsumptionUtils;
    const BS = window.BatterySimulation;
    const hasBattery = !!p.battery;

    const days = [];
	const annualData = [];
	
    let socPct = p.initialSocPct != null ? p.initialSocPct : 10;
    let economieRealiseeEur = 0;

    for (let m = 0; m < 12; m++) {
      for (let d = 1; d <= U.DAYS_IN_MONTH[m]; d++) {
        const key = String(m + 1).padStart(2, "0") + "-" + String(d).padStart(2, "0");
        const dayHourly = p.pvgisHourlyDaysByKey[key];
        const consumptionW = p.consumptionDaysByKey[key];
        if (!dayHourly || !consumptionW) continue; // vérifié en amont (complétude des caches), ne devrait pas arriver

        const potential = computeDayPotentialProduction(
          dayHourly, p.lat, p.lng, p.ratedTotalWc, p.tiltDeg, p.orientationDeg, p.mask
        );
        const consumptionSegments = consumptionW.map((v, i) => ({
          startHour: i * 0.25,
          endHour: i * 0.25 + 0.25,
          powerW: v,
        }));

        const result = BS.simulateDay({
          stepMinutes: 15,
          productionPoints: potential.points,
          consumptionSegments,
          tariffs: p.tariffs,
          sellTariffPerKwh: p.sellTariffPerKwh,
          battery: p.battery,
          batteryCount: 1,
          hasInverter: p.hasInverter,
          inverterEfficiencyPct: p.inverterEfficiencyPct,
          chargeStrategy: p.chargeStrategy,
          dischargeStrategy: p.dischargeStrategy,
          sellMode: p.sellMode,
          initialSocPct: socPct,
        });

        let directKwh = 0;
        let viaBatteryKwh = 0;
        let chargeeDansBatterieKwh = 0;
        let surplusKwh = 0;
        let peakSocPct = 0;
        let troughSocPct = 100;
		let sumSocPct = 0;
		let averageSocPct = 0;
		let numPt =0;
		
		let consommationReseauHpKwh = 0;
		let consommationReseauHcKwh = 0;

        result.points.forEach((pt) => {
          const autoconsommeeW = pt.solarToHouseW + pt.batteryDischargeW;
          const tariff = U.tariffForHour(p.tariffs, pt.hour);
          if (autoconsommeeW > 0) {
            economieRealiseeEur += (autoconsommeeW / 1000) * 0.25 * (tariff ? tariff.pricePerKwh : 0);
          }
          directKwh += (pt.solarToHouseW / 1000) * 0.25;
          viaBatteryKwh += (pt.batteryDischargeW / 1000) * 0.25;
          chargeeDansBatterieKwh += (pt.batteryChargeW / 1000) * 0.25;
          surplusKwh += (pt.gridExportW / 1000) * 0.25;
          if (pt.socPct > peakSocPct) peakSocPct = pt.socPct;
          if (pt.socPct < troughSocPct) troughSocPct = pt.socPct;
		  numPt +=1;
		  sumSocPct += pt.socPct;
		  averageSocPct = sumSocPct/numPt;
		  
		  const tariffCategory = U.classifyTariff(tariff);
		  const gridImportKwh = (pt.gridImportW / 1000) * 0.25;

		  if (tariffCategory === "hp") {
			consommationReseauHpKwh += gridImportKwh;
		  } else if (tariffCategory === "hc") {
			consommationReseauHcKwh += gridImportKwh;
		  }
        });

        const consommationTotaleKWh = result.totalConsumptionKwh;
        const consommationReseauKWh = consommationReseauHpKwh + consommationReseauHcKwh;

        socPct = hasBattery && result.points.length > 0 ? result.points[result.points.length - 1].socPct : socPct;

        annualData.push({
			day: result.points,
		});
		
        days.push({
          date: key,
          month: m + 1,
          productionPotentielleKWh: result.totalProductionKwh,
          productionReelleKWh: directKwh + chargeeDansBatterieKwh + surplusKwh,
          productionAutoconsommeeDirecteKWh: directKwh,
          productionViaBatterieKWh: viaBatteryKwh,
          chargeeDansBatterieKWh: hasBattery ? chargeeDansBatterieKwh : 0,
          surplusVenduKWh: surplusKwh,
		  consommationReseauHpKwh,
		  consommationReseauHcKwh,
          consommationReseauKWh,
          consommationTotaleKWh,
          picChargeBatteriePct: hasBattery ? peakSocPct : null,
          picDechargeBatteriePct: hasBattery ? troughSocPct : null,
		  moyenneUtilisationBatteriePct: hasBattery ? averageSocPct : null,
		  coutHc: result.costHc,
		  coutHp: result.costHp,
        });
      }
    }

    const months = [];
    for (let m = 1; m <= 12; m++) {
      const dayList = days.filter((d) => d.month === m);
      months.push({
        month: m,
        productionReelleKWh: sumField(dayList, "productionReelleKWh"),
        productionAutoconsommeeDirecteKWh: sumField(dayList, "productionAutoconsommeeDirecteKWh"),
        productionViaBatterieKWh: sumField(dayList, "productionViaBatterieKWh"),
        chargeeDansBatterieKWh: sumField(dayList, "chargeeDansBatterieKWh"),
        consommationReseauKWh: sumField(dayList, "consommationReseauKWh"),
		consommationReseauHpKwh: sumField(dayList, "consommationReseauHpKwh"),
		consommationReseauHcKwh: sumField(dayList, "consommationReseauHcKwh"),
        consommationTotaleKWh: sumField(dayList, "consommationTotaleKWh"),
		productionInjecteeKWh: sumField(dayList, "surplusVenduKWh"),
      });
    }

    const totalProductionReelleKWh = sumField(days, "productionReelleKWh");
    const totalAutoconsommeeBrutKWh = sumField(days, "productionAutoconsommeeDirecteKWh") + sumField(days, "chargeeDansBatterieKWh");
    const totalAutoconsommeeNetKWh = sumField(days, "productionAutoconsommeeDirecteKWh") + sumField(days, "productionViaBatterieKWh");
    const totalConsommationKWh = sumField(days, "consommationTotaleKWh");
    const totalConsommationHpKWh = sumField(days, "consommationReseauHpKwh");
    const totalConsommationHcKWh = sumField(days, "consommationReseauHcKwh");
    const totalConsommationHpHcKWh = totalConsommationHpKWh + totalConsommationHcKWh;
    const totalSurplusKWh = sumField(days, "surplusVenduKWh");
    const economieReventeEur = p.sellMode === "sell" ? totalSurplusKWh * p.sellTariffPerKwh : 0;

    return {
	  annualData,
      days,
      months,
      hasBattery,
      indicators: {
        tauxAutoconsommationPct: totalProductionReelleKWh > 0 ? (totalAutoconsommeeBrutKWh / totalProductionReelleKWh) * 100 : 0,
        tauxAutoproductionPct: totalConsommationKWh > 0 ? (totalAutoconsommeeNetKWh / totalConsommationKWh) * 100 : 0,
        economieRealiseeEur,
        economieReventeEur,
        productionPotentielleTotalKWh: sumField(days, "productionPotentielleKWh"),
        productionConsommeeTotalKWh: totalAutoconsommeeBrutKWh,
        productionConsommeeNetKWh: totalAutoconsommeeNetKWh,
        consommationTotaleKWh: totalConsommationKWh,
		consommationTotaleHpKWh:totalConsommationHpKWh,
		consommationTotaleHcKWh:totalConsommationHcKWh,
		productionSimuleeTotalKWh: totalProductionReelleKWh,
		surplusInjecteKWh: totalSurplusKWh,
		consommationTotaleReseauKWh: totalConsommationHpHcKWh,//totalConsommationKWh-totalAutoconsommeeNetKWh,
		energieChargeeBatterieTotalKWh: sumField(days, "chargeeDansBatterieKWh"),
		energieDechargeeBatterieTotalKWh: sumField(days, "productionViaBatterieKWh"),
		coutTotalHc: sumField(days, "coutHc"),
		coutTotalHp: sumField(days, "coutHp"),
	  },
    };
  }

  return {
    computeDayPotentialProduction,
    simulateYear,
  };
})();
