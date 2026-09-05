/**
 * solar-geometry.js
 *
 * Fonctions pures de géométrie solaire. Aucune dépendance réseau :
 * tout est calculé à partir de la latitude, de la longitude et
 * d'une date. Sert de base à l'onglet "Localisation" (angles aux
 * solstices) et à l'onglet "Panneaux solaires" (production
 * théorique horaire).
 *
 * Conventions :
 *  - Angles d'entrée/sortie "publiques" en degrés.
 *  - Calculs internes en radians (suffixe _rad).
 *  - elevation = hauteur du soleil au-dessus de l'horizon (0° = horizon, 90° = zénith)
 *  - azimuth   = direction du soleil, 0°=Nord, 90°=Est, 180°=Sud, 270°=Ouest
 */

window.SolarGeometry = (function () {
  "use strict";

  const DEG2RAD = Math.PI / 180;
  const RAD2DEG = 180 / Math.PI;

  /**
   * Jour de l'année (1-366) pour une Date donnée.
   */
  function dayOfYear(date) {
    const start = new Date(date.getFullYear(), 0, 1);
    const diff = date - start;
    return Math.floor(diff / 86400000) + 1;
  }

  /**
   * Déclinaison solaire (dépend uniquement du jour de l'année).
   * Approximation de Cooper (1969), précision suffisante pour un
   * usage résidentiel (~±0.2° erreur max).
   */
  function solarDeclination(dayOfYear) {
    const angle = (360 / 365) * (dayOfYear - 81);
    return 23.45 * Math.sin(angle * DEG2RAD);
  }

  /**
   * Équation du temps (en minutes), corrige l'écart entre temps
   * solaire vrai et temps solaire moyen. Approximation standard.
   */
  function equationOfTime(dayOfYear) {
    const b = ((360 / 364) * (dayOfYear - 81)) * DEG2RAD;
    return 9.87 * Math.sin(2 * b) - 7.53 * Math.cos(b) - 1.5 * Math.sin(b);
  }

  /**
   * Angle horaire solaire (en degrés) pour une heure locale donnée.
   * hourDecimal : heure locale décimale (ex : 14.5 = 14h30), heure LOCALE au méridien de référence.
   * longitude   : degrés, positif = Est
   * timezoneOffset : décalage UTC de la zone horaire locale (ex : +1 pour la France en hiver, +2 en été)
   */
  function hourAngle(hourDecimal, dayOfYear, longitude, timezoneOffset) {
    const eot = equationOfTime(dayOfYear);
    const referenceLongitude = timezoneOffset * 15; // 15° par heure de décalage UTC
    const timeCorrection = 4 * (longitude - referenceLongitude) + eot; // minutes
    const solarTime = hourDecimal + timeCorrection / 60;
    return (solarTime - 12) * 15; // degrés, 15°/heure
  }

  /**
   * Élévation solaire (degrés au-dessus de l'horizon) pour une
   * latitude, une déclinaison et un angle horaire donnés.
   */
  function elevationAngle(latitude, declination, hourAngleDeg) {
    const lat = latitude * DEG2RAD;
    const dec = declination * DEG2RAD;
    const ha = hourAngleDeg * DEG2RAD;
    const sinElevation =
      Math.sin(lat) * Math.sin(dec) + Math.cos(lat) * Math.cos(dec) * Math.cos(ha);
    return Math.asin(Math.max(-1, Math.min(1, sinElevation))) * RAD2DEG;
  }

  /**
   * Azimut solaire (degrés, 0=Nord, 90=Est, 180=Sud, 270=Ouest).
   */
  function azimuthAngle(latitude, declination, hourAngleDeg, elevationDeg) {
    const lat = latitude * DEG2RAD;
    const dec = declination * DEG2RAD;
    const ha = hourAngleDeg * DEG2RAD;
    const elev = elevationDeg * DEG2RAD;

    let cosAz =
      (Math.sin(dec) - Math.sin(elev) * Math.sin(lat)) / (Math.cos(elev) * Math.cos(lat));
    cosAz = Math.max(-1, Math.min(1, cosAz));
    let azimuth = Math.acos(cosAz) * RAD2DEG;

    if (hourAngleDeg > 0) {
      azimuth = 360 - azimuth;
    }
    return azimuth;
  }

  /**
   * Élévation solaire max du jour (= au midi solaire), la façon la
   * plus rapide de répondre à "quel est le risque d'ombre ?".
   */
  function maxElevationForDay(latitude, dayOfYear) {
    const declination = solarDeclination(dayOfYear);
    return elevationAngle(latitude, declination, 0);
  }

  /**
   * Calcule la courbe élévation/azimut sur une journée, pas de
   * `stepMinutes` minutes, pour une latitude/longitude/jour donnés.
   * Retourne uniquement les points où le soleil est au-dessus de
   * l'horizon (elevation > 0).
   */
  function dayCurve(latitude, longitude, timezoneOffset, doy, stepMinutes) {
    stepMinutes = stepMinutes || 10;
    const declination = solarDeclination(doy);
    const points = [];
    for (let h = 0; h <= 24; h += stepMinutes / 60) {
      const ha = hourAngle(h, doy, longitude, timezoneOffset);
      const elevation = elevationAngle(latitude, declination, ha);
      if (elevation > 0) {
        const azimuth = azimuthAngle(latitude, declination, ha, elevation);
        points.push({ hour: h, elevation, azimuth });
      }
    }
    return points;
  }

  /**
   * Convertit un azimut convention "0=Nord" vers la convention utilisée
   * pour l'orientation des panneaux : 0=Sud, négatif=Est, positif=Ouest.
   * Ex: azimut 90° (Est) -> -90 ; azimut 270° (Ouest) -> +90.
   */
  function azimuthToSouthRelative(azimuthDeg) {
    let v = azimuthDeg - 180;
    if (v > 180) v -= 360;
    if (v < -180) v += 360;
    return v;
  }

  /**
   * Heure (locale, décimale) et azimut (sud-relatif) du lever et du
   * coucher du soleil pour un jour donné, à un seuil d'élévation
   * choisi (0° = horizon théorique parfait ; une valeur positive,
   * ex. 5°, modélise un horizon masqué par le bâti/le relief/les
   * arbres — plus réaliste pour évaluer le risque d'ombre).
   *
   * Retourne { polarDay: true } si le soleil ne descend jamais sous
   * le seuil, { polarNight: true } s'il ne le dépasse jamais
   * (uniquement pertinent aux latitudes extrêmes).
   */
  function sunTimesForDay(latitude, longitude, timezoneOffset, doy, elevationThresholdDeg) {
    elevationThresholdDeg = elevationThresholdDeg || 0;
    const declination = solarDeclination(doy);
    const lat = latitude * DEG2RAD;
    const dec = declination * DEG2RAD;
    const elev = elevationThresholdDeg * DEG2RAD;

    const cosHa =
      (Math.sin(elev) - Math.sin(lat) * Math.sin(dec)) / (Math.cos(lat) * Math.cos(dec));

    if (cosHa < -1) return { polarDay: true };
    if (cosHa > 1) return { polarNight: true };

    const haDeg = Math.acos(cosHa) * RAD2DEG; // valeur positive ; coucher=+haDeg, lever=-haDeg

    const eot = equationOfTime(doy);
    const referenceLongitude = timezoneOffset * 15;
    const timeCorrection = 4 * (longitude - referenceLongitude) + eot; // minutes
    const haToHour = (ha) => 12 + ha / 15 - timeCorrection / 60;

    const sunriseHour = haToHour(-haDeg);
    const sunsetHour = haToHour(haDeg);
    const sunriseAzimuth = azimuthAngle(latitude, declination, -haDeg, elevationThresholdDeg);
    const sunsetAzimuth = azimuthAngle(latitude, declination, haDeg, elevationThresholdDeg);

    return {
      sunriseHour,
      sunsetHour,
      sunriseAzimuthSouth: azimuthToSouthRelative(sunriseAzimuth),
      sunsetAzimuthSouth: azimuthToSouthRelative(sunsetAzimuth),
    };
  }

  /**
   * Cosinus de l'angle d'incidence entre les rayons du soleil et la
   * normale au panneau — le cœur de la physique de production PV.
   * cos(θ)=1 quand le soleil frappe le panneau perpendiculairement
   * (production géométrique maximale), 0 ou négatif quand les rayons
   * rasent ou sont sous le plan du panneau (aucune production).
   *
   * Formule standard (Duffie & Beckman) :
   *   cosθ = sin(élévation)·cos(inclinaison)
   *        + cos(élévation)·sin(inclinaison)·cos(azimutSoleil − azimutPanneau)
   *
   * azimutSoleil et azimutPanneau doivent être dans la même convention
   * sud-relative (0=Sud, -=Est, +=Ouest — voir azimuthToSouthRelative).
   * Vérifié : à midi solaire à l'équinoxe, avec inclinaison=latitude,
   * cosθ=1 (incidence parfaitement perpendiculaire), comme attendu.
   */
  function cosIncidenceAngle(elevationDeg, sunAzimuthSouthDeg, tiltDeg, panelAzimuthSouthDeg) {
    const elev = elevationDeg * DEG2RAD;
    const tilt = tiltDeg * DEG2RAD;
    const deltaAz = (sunAzimuthSouthDeg - panelAzimuthSouthDeg) * DEG2RAD;
    return Math.sin(elev) * Math.cos(tilt) + Math.cos(elev) * Math.sin(tilt) * Math.cos(deltaAz);
  }

  /**
   * Irradiance directe normale (DNI, W/m²) sous ciel clair standard
   * (modèle simplifié courant, parfois attribué à Meinel & Meinel /
   * proche du modèle ASHRAE) :
   *
   *   DNI = A · 0.7^(masse d'air ^ 0.678),  masse d'air = 1/sin(élévation)
   *
   * A = 1353 W/m² (constante solaire hors atmosphère). Contrairement à
   * une hypothèse "1000 W/m² dès que le soleil est levé", ce modèle
   * tient compte de l'épaisseur d'atmosphère traversée par la lumière
   * (bien plus grande à faible élévation, même ciel parfaitement
   * clair) : l'irradiance chute fortement près de l'horizon et tend
   * vers 0 à élévation nulle, quelle que soit l'orientation du plan
   * qui la reçoit ensuite. Vérifié par recoupement externe (calcul
   * manuel + deux outils IA indépendants) : à Paris au solstice d'été,
   * élévation max 64.6°, ce modèle donne ~923 W/m² (~417 W pour un
   * panneau 500 Wc horizontal), cohérent à quelques % près.
   */
  function clearSkyDni(elevationDeg) {
    if (elevationDeg <= 0) return 0;
    const airMass = 1 / Math.sin(elevationDeg * DEG2RAD);
    return 1353 * Math.pow(0.7, Math.pow(airMass, 0.678));
  }

  /** Jours de référence pour les solstices/équinoxe (année non bissextile, suffisant ici). */
  const REFERENCE_DAYS = {
    solsticeEte: 172,      // ~21 juin
    solsticeHiver: 355,    // ~21 décembre
    equinoxe: 80,           // ~21 mars / 23 sept (élévation identique aux deux équinoxes)
  };

  return {
    DEG2RAD,
    RAD2DEG,
    dayOfYear,
    solarDeclination,
    equationOfTime,
    hourAngle,
    elevationAngle,
    azimuthAngle,
    maxElevationForDay,
    dayCurve,
    azimuthToSouthRelative,
    sunTimesForDay,
    cosIncidenceAngle,
    clearSkyDni,
    REFERENCE_DAYS,
  };
})();
