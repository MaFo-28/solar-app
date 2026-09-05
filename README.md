# Rentabilité solaire — squelette de l'application

## Utilisation
Dézippez ce dossier, puis double-cliquez sur `index.html`.
Ça s'ouvre directement dans votre navigateur, aucune installation requise.

## Ce qui fonctionne déjà
- Onglet 1 (Localisation) : géocodage d'adresse (via Nominatim/OSM),
  saisie manuelle lat/long, calcul des angles solaires aux solstices,
  courbe d'élévation sur 24h, récupération PVGIS, tarifs HC/HP
  éditables, sauvegarde/chargement du projet en fichier .json.
- Onglets 2 à 4 (Panneaux/Onduleur/Batterie) : sélection dans une
  base de données locale (à enrichir), champs de base.
- Onglet 5 (Consommation) : saisie horaire manuelle, courbe, coût du jour.
- Onglet 7 (Bilan financier) : coût matériel total (calcul simple).
- Onglet 6 (Stratégie) : à concevoir.

## Notes techniques
- Aucune dépendance externe au chargement : Chart.js est embarqué
  dans js/vendor/, les bases de données matériel sont des fichiers
  .js (pas de fetch de .json, pour éviter les blocages CORS en
  ouverture directe file://).
- Géocodage et PVGIS nécessitent une connexion réseau ponctuelle ;
  le reste fonctionne hors-ligne.
- L'état de l'application est centralisé dans js/state.js (un seul
  objet AppState), avec autosave dans le localStorage du navigateur
  en plus du save/load explicite en fichier .json.
