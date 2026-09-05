/**
 * horizon-mask.js
 *
 * Logique partagée d'évaluation d'un masque d'horizon (obstacles par
 * plage d'azimut). Utilisée par l'onglet Localisation (graphiques,
 * détection de conflit) ET l'onglet Panneaux (masquage de la
 * production). Centralisée ici pour ne pas dupliquer la même
 * fonction dans chaque onglet.
 */
window.HorizonMask = (function () {
  "use strict";

  /**
   * Hauteur d'obstacle (degrés) à un azimut sud-relatif donné : le
   * plus haut obstacle dont la plage [azimuthStart, azimuthEnd]
   * couvre cet azimut, sinon 0 (pas d'obstacle connu à cet endroit —
   * pas d'extrapolation au-delà des plages définies par l'utilisateur).
   */
  function elevationAt(mask, azimuthSouth) {
    let maxElevation = 0;
    (mask || []).forEach((m) => {
      if (azimuthSouth >= m.azimuthStart && azimuthSouth <= m.azimuthEnd) {
        maxElevation = Math.max(maxElevation, m.elevationDeg);
      }
    });
    return maxElevation;
  }

  /** Vrai si le soleil (à cette élévation/azimut) est masqué par un obstacle. */
  function isMasked(mask, elevationDeg, azimuthSouth) {
    return elevationDeg < elevationAt(mask, azimuthSouth);
  }

  return { elevationAt, isMasked };
})();
