/**
 * dom-utils.js
 *
 * Utilitaire partagé : évite qu'un écouteur d'événement soit attaché
 * plusieurs fois sur le même élément. Nécessaire car les fonctions
 * d'initialisation des onglets peuvent être rappelées plusieurs fois
 * dans une même session (après le chargement d'un projet — voir
 * App.refreshAllTabs — ou quand un sélecteur est reconstruit après
 * modification d'une base de données). Sans cette protection, chaque
 * rappel empile un nouvel écouteur sur le même bouton, et un clic
 * déclenche alors la fonction plusieurs fois d'affilée (symptôme
 * typique : une boîte de dialogue qui semble "rester ouverte", ou une
 * action qui se produit en double).
 */
window.bindOnce = function (el, eventName, handler) {
  if (!el) return;
  const flagKey = "_bound_" + eventName;
  if (el[flagKey]) return; // déjà attaché sur cet élément, on ne rajoute rien
  el.addEventListener(eventName, handler);
  el[flagKey] = true;
};
