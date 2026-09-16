/**
 * pv-production.js
 *
 * Calculs de production photovoltaïque. Séparé de tab-simulation.js pour
 * garder la logique de calcul (pure, testable) indépendante du DOM.
 *
 * Deux niveaux de calcul :
 *
 * 1. THÉORIQUE (ciel clair) : modèle géométrique + modèle standard
 *    d'irradiance ciel clair (clearSkyDni dans solar-geometry.js), qui
 *    tient compte de l'atténuation atmosphérique selon la hauteur du
 *    soleil (plus faible à l'horizon, même sans nuage — pas une
 *    hypothèse "1000 W/m² dès que le soleil est levé"). Vérifié par
 *    recoupement avec deux outils IA indépendants (ChatGPT, Perplexity)
 *    sur plusieurs cas d'inclinaison. Sert pour les courbes horaires
 *    aux solstices/équinoxe — répond à "quelle est la production MAX
 *    possible par temps clair avec cette orientation/inclinaison ?",
 *    pas à "combien vais-je produire réellement" (nuages non inclus).
 *
 * 2. RÉALISTE MENSUEL (transposition PVGIS) : les données PVGIS déjà
 *    en cache (irradiance horizontale réelle, incluant l'effet des
 *    nuages) sont comparées à NOTRE PROPRE modèle théorique horizontal
 *    pour obtenir un "indice de ciel clair" mois par mois (réel/
 *    théorique). Cet indice est ensuite appliqué à notre modèle
 *    théorique sur le plan incliné des panneaux, pour estimer
 *    l'irradiance réelle reçue par les panneaux sans avoir à
 *    re-solliciter PVGIS avec l'inclinaison exacte (rappel : PVGIS
 *    bloque les requêtes AJAX, voir tab-location.js). C'est une
 *    approximation d'ingénierie standard, pas une resimulation
 *    météorologique complète.
 */
window.PvProduction = (function () {
  "use strict";

  const G = window.SolarGeometry;

  /**
   * Production instantanée théorique (W) pour un instant donné,
   * intégrant orientation/inclinaison des panneaux ET masquage complet
   * par le profil d'ombre choisi (0 W si masqué, pas d'atténuation
   * partielle — cf. discussion avec l'utilisateur, volontairement
   * simplifié).
   */
  function instantPowerW(ratedTotalWc, elevationDeg, sunAzimuthSouthDeg, tiltDeg, panelAzimuthSouthDeg, mask) {
    if (elevationDeg <= 0) return 0;
    if (window.HorizonMask.isMasked(mask, elevationDeg, sunAzimuthSouthDeg)) return 0;
    const cosTheta = G.cosIncidenceAngle(elevationDeg, sunAzimuthSouthDeg, tiltDeg, panelAzimuthSouthDeg);
    const dniRatio = G.clearSkyDni(elevationDeg) / 1000; // référence STC 1000 W/m²
    return ratedTotalWc * dniRatio * Math.max(0, cosTheta);
  }

  /**
   * Puissance pile à l'instant du lever/coucher (élévation=0 exactement).
   * Avec le modèle d'irradiance ciel clair (clearSkyDni), l'irradiance
   * directe est nulle pile à l'horizon par construction — donc cette
   * puissance est toujours 0, quelle que soit l'orientation du panneau
   * (ce n'était pas le cas avec l'ancien modèle "1000 W/m² constant",
   * d'où le saut observé sur les panneaux très inclinés/verticaux).
   */
  function boundaryPowerW() {
    return 0;
  }

  /**
   * Courbe de puissance théorique sur une journée (pas de 10 min par
   * défaut), pour un jour de l'année donné. Retourne aussi l'énergie
   * totale du jour (kWh), calculée par intégration trapézoïdale.
   */
  function dayPowerCurve(lat, lng, tz, doy, ratedTotalWc, tiltDeg, orientationDeg, mask, stepMinutes) {
    stepMinutes = stepMinutes || 10;
    const raw = G.dayCurve(lat, lng, tz, doy, stepMinutes);
    const points = raw.map((p) => {
      const azSouth = G.azimuthToSouthRelative(p.azimuth);
      const powerW = instantPowerW(ratedTotalWc, p.elevation, azSouth, tiltDeg, orientationDeg, mask);
      return { hour: p.hour, powerW, elevation: p.elevation, azimuthSouth: azSouth };
    });

    // La puissance dépend de l'angle d'incidence (soleil/panneau), pas
    // directement de l'élévation : contrairement à une courbe
    // d'élévation, elle n'atteint pas forcément ~0 au dernier point
    // échantillonné avant le lever/coucher (ça dépend de l'orientation
    // du panneau — un panneau presque vertical dépend surtout de
    // l'azimut, pas de l'élévation, et peut avoir une puissance encore
    // significative pile au lever/coucher). Sans point de fermeture
    // explicite, le graphique s'arrête net au lieu de rejoindre
    // visuellement le bord réel. On calcule donc la VRAIE puissance
    // (via cosTheta, comme partout ailleurs) à l'azimut exact du
    // lever/coucher plutôt que de forcer 0 arbitrairement — 0 n'est
    // correct que quand la géométrie le donne réellement (cas d'un
    // panneau peu incliné, où cosTheta ≈ sin(élévation) → 0).
    const sunTimes = G.sunTimesForDay(lat, lng, tz, doy, 0);
    if (!sunTimes.polarDay && !sunTimes.polarNight) {
      const sunrisePowerW = boundaryPowerW(ratedTotalWc, sunTimes.sunriseAzimuthSouth, tiltDeg, orientationDeg, mask);
      const sunsetPowerW = boundaryPowerW(ratedTotalWc, sunTimes.sunsetAzimuthSouth, tiltDeg, orientationDeg, mask);
      points.unshift({ hour: sunTimes.sunriseHour, powerW: sunrisePowerW, elevation: 0, azimuthSouth: sunTimes.sunriseAzimuthSouth });
      points.push({ hour: sunTimes.sunsetHour, powerW: sunsetPowerW, elevation: 0, azimuthSouth: sunTimes.sunsetAzimuthSouth });
    }

    let energyWh = 0;
    for (let i = 1; i < points.length; i++) {
      const dtHours = points[i].hour - points[i - 1].hour;
      energyWh += ((points[i].powerW + points[i - 1].powerW) / 2) * dtHours;
    }

    return { points, energyKwh: energyWh / 1000 };
  }

  /**
   * Irradiation théorique reçue par une surface (kWh/m²) sur un jour
   * donné, ciel clair idéal (1 kW/m² perpendiculaire), pour un plan
   * d'inclinaison/orientation donné (tilt=0 => plan horizontal).
   * `mask` optionnel : si fourni, les heures masquées ne comptent pas.
   */
  function dayIrradiationKwhM2(lat, lng, tz, doy, tiltDeg, orientationDeg, mask, stepMinutes) {
    stepMinutes = stepMinutes || 15;
    const raw = G.dayCurve(lat, lng, tz, doy, stepMinutes);
    const values = raw.map((p) => {
      const azSouth = G.azimuthToSouthRelative(p.azimuth);
      if (mask && window.HorizonMask.isMasked(mask, p.elevation, azSouth)) return { hour: p.hour, v: 0 };
      const cosTheta = G.cosIncidenceAngle(p.elevation, azSouth, tiltDeg, orientationDeg);
      const dniRatio = G.clearSkyDni(p.elevation) / 1000;
      return { hour: p.hour, v: Math.max(0, cosTheta) * dniRatio }; // en kW/m² (référence 1 kW/m²)
    });
    let kwhM2 = 0;
    for (let i = 1; i < values.length; i++) {
      const dt = values[i].hour - values[i - 1].hour;
      kwhM2 += ((values[i].v + values[i - 1].v) / 2) * dt;
    }
    return kwhM2;
  }

  const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

  /** Jour de l'année représentatif du milieu de chaque mois (1-12). */
  function midMonthDayOfYear(month) {
    let cumulative = 0;
    for (let m = 1; m < month; m++) cumulative += DAYS_IN_MONTH[m - 1];
    return cumulative + Math.round(DAYS_IN_MONTH[month - 1] / 2);
  }

  /**
   * Extrait du cache PVGIS les moyennes mensuelles d'irradiation
   * horizontale globale H(h)_m (kWh/m²/mois) ET le ratio diffus/global
   * Kd (nécessite d2g=1 dans la requête PVGIS, voir tab-location.js),
   * moyennées sur toutes les années disponibles. Renvoie null si le
   * cache est absent ou d'un format inattendu.
   */
  function extractPvgisMonthlyData(pvgisCache) {
    try {
      const monthly = pvgisCache.outputs.monthly;
      if (!Array.isArray(monthly) || monthly.length === 0) return null;
      const sumsH = new Array(13).fill(0);
      const sumsKd = new Array(13).fill(0);
      const counts = new Array(13).fill(0);
      const countsKd = new Array(13).fill(0);
      monthly.forEach((entry) => {
        const m = entry.month;
        if (m < 1 || m > 12) return;
        if (typeof entry["H(h)_m"] === "number") {
          sumsH[m] += entry["H(h)_m"];
          counts[m] += 1;
        }
        if (typeof entry.Kd === "number") {
          sumsKd[m] += entry.Kd;
          countsKd[m] += 1;
        }
      });
      const result = [];
      for (let m = 1; m <= 12; m++) {
        if (counts[m] === 0) return null; // données globales incomplètes, on ne bricole pas
        result.push({
          ghiKwhM2: sumsH[m] / counts[m],
          // Kd manquant (cache récupéré avant l'ajout de d2g=1) : valeur
          // par défaut raisonnable pour un climat tempéré plutôt que de
          // bloquer complètement l'estimation.
          kd: countsKd[m] > 0 ? sumsKd[m] / countsKd[m] : 0.45,
          kdIsDefault: countsKd[m] === 0,
        });
      }
      return result; // index 0 = janvier .. index 11 = décembre
    } catch (e) {
      return null;
    }
  }

  /**
   * Estimation de la production mensuelle réaliste (kWh/mois), par
   * transposition de l'irradiation horizontale réelle (PVGIS) vers le
   * plan incliné des panneaux — modèle du ciel isotrope (Liu-Jordan),
   * standard en ingénierie solaire :
   *
   *  - composante directe (beam) : mise à l'échelle par le ratio
   *    géométrique clair-ciel (incliné/horizontal) de NOTRE modèle —
   *    valide car le direct suit purement la géométrie cosθ. C'est
   *    aussi ce ratio qui porte l'effet du masquage (les heures
   *    masquées sont exclues de l'intégrale inclinée, pas de
   *    l'horizontale).
   *  - composante diffuse : mise à l'échelle par (1+cos(inclinaison))/2
   *    (fraction de la voûte céleste vue par le panneau incliné).
   *  - composante réfléchie par le sol : GHI × albédo × (1-cos(inclinaison))/2,
   *    albédo=0.2 par défaut (sol/herbe standard).
   *
   * Sans cette séparation, un modèle purement géométrique traite tout
   * le rayonnement comme direct et surestime nettement l'avantage de
   * l'inclinaison (vérifié : ~1.34 au lieu de ~1.15-1.20 pour un
   * panneau sud à 30° à Paris).
   */
  function monthlyProductionEstimate(lat, lng, tz, ratedTotalWc, tiltDeg, orientationDeg, mask, pvgisCache) {
    const monthlyData = extractPvgisMonthlyData(pvgisCache);
    if (!monthlyData) return null;

    const albedo = 0.2;
    const tiltRad = (tiltDeg * Math.PI) / 180;
    const ratedTotalKwc = ratedTotalWc / 1000;
    const months = [];

    for (let month = 1; month <= 12; month++) {
      const doy = midMonthDayOfYear(month);
      const daysInMonth = DAYS_IN_MONTH[month - 1];
      const { ghiKwhM2, kd, kdIsDefault } = monthlyData[month - 1];

      const beamActual = (1 - kd) * ghiKwhM2;
      const diffuseActual = kd * ghiKwhM2;

      // ratio géométrique clair-ciel incliné/horizontal (porte aussi
      // l'effet du masquage, exclu uniquement côté incliné)
      const theoreticalHorizontal = dayIrradiationKwhM2(lat, lng, tz, doy, 0, 0, null) * daysInMonth;
      const theoreticalTilted = dayIrradiationKwhM2(lat, lng, tz, doy, tiltDeg, orientationDeg, mask) * daysInMonth;
      const beamTranspositionRatio = theoreticalHorizontal > 0 ? theoreticalTilted / theoreticalHorizontal : 0;

      const beamTilted = beamActual * beamTranspositionRatio;
      const diffuseTilted = diffuseActual * ((1 + Math.cos(tiltRad)) / 2);
      const reflectedTilted = ghiKwhM2 * albedo * ((1 - Math.cos(tiltRad)) / 2);

      const totalTiltedIrradiation = beamTilted + diffuseTilted + reflectedTilted;
      const productionKwh = ratedTotalKwc * totalTiltedIrradiation;
	  
      months.push({
        month,
        irradiationKwhM2: totalTiltedIrradiation,
        productionKwh,
        kdIsDefault,
      });
    }

    return months;
  }

  /**
   * Valorise la production mensuelle déjà calculée (monthlyProductionEstimate)
   * selon le tarif électrique applicable à chaque heure du jour
   * représentatif — c'est le montant maximal économisable SI 100% de
   * cette production était autoconsommée (pas de perte, pas de
   * surplus revendu/perdu). Sert de repère haut, pas une prévision de
   * gain réel (qui dépend de la stratégie de charge/décharge et du
   * profil de consommation, calculés dans le simulateur).
   *
   * Méthode : la courbe horaire théorique (même forme que le graphique
   * "Production horaire") est mise à l'échelle pour que son total
   * journalier corresponde exactement à la production réaliste déjà
   * calculée pour ce mois (jour_réaliste = mois_réaliste / jours du
   * mois) — on récupère ainsi une forme horaire plausible sans
   * recalculer toute la décomposition direct/diffus/réfléchi.
   */
  function monthlyProductionValueEur(lat, lng, tz, ratedTotalWc, tiltDeg, orientationDeg, mask, months, tariffs) {
    const U = window.ConsumptionUtils;
    return months.map((m) => {
      const doy = midMonthDayOfYear(m.month);
      const daysInMonth = DAYS_IN_MONTH[m.month - 1];
      const dayResult = dayPowerCurve(lat, lng, tz, doy, ratedTotalWc, tiltDeg, orientationDeg, mask, 15);
      const theoreticalDailyKwh = dayResult.energyKwh;
      const actualDailyKwh = m.productionKwh / daysInMonth;
      const scaleFactor = theoreticalDailyKwh > 0 ? actualDailyKwh / theoreticalDailyKwh : 0;

      let dayValueEur = 0;
      for (let i = 1; i < dayResult.points.length; i++) {
        const dt = dayResult.points[i].hour - dayResult.points[i - 1].hour;
        const avgPowerW = ((dayResult.points[i].powerW + dayResult.points[i - 1].powerW) / 2) * scaleFactor;
        const avgHour = (dayResult.points[i].hour + dayResult.points[i - 1].hour) / 2;
        const tariff = U.tariffForHour(tariffs, avgHour);
        const kwh = (avgPowerW / 1000) * dt;
        dayValueEur += kwh * (tariff ? tariff.pricePerKwh : 0);
      }

      return { month: m.month, valueEur: dayValueEur * daysInMonth };
    });
  }

  return {
    instantPowerW,
    dayPowerCurve,
    dayIrradiationKwhM2,
    extractPvgisMonthlyData,
    monthlyProductionEstimate,
    monthlyProductionValueEur,
    midMonthDayOfYear,
  };
})();
