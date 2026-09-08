# Rentabilité solaire

Application web permettant de **simuler une installation photovoltaïque complète et d'en évaluer la rentabilité** à partir de données de production solaire, de consommation et de tarifs d'électricité.

L'application permet de choisir précisément le matériel utilisé (panneaux, onduleur, batterie), de définir l'installation et sa stratégie de batterie, puis de simuler son fonctionnement sur une année complète.

## Fonctionnalités

### 1. Localisation

* Définition du lieu d'installation par adresse ou coordonnées GPS
* Récupération des données de production solaire depuis **PVGIS**
* Affichage de la production théorique mensuelle
* Choix de l'année PVGIS utilisée pour la simulation annuelle (2005 à 2023 selon les données disponibles)
* Gestion des tarifs d'électricité HP/HC
* Définition du tarif de revente du surplus
* Création de profils d'ombrage
* Pour chaque ombrage : angle de début, angle de fin par rapport au sud et hauteur de l'obstacle
* Calculette permettant de recalculer l'élévation d'un obstacle lorsque la position d'installation ne correspond pas à celle de la mesure

### PVGIS et calcul de production

Deux types de données PVGIS sont utilisés :

* une moyenne mensuelle pour obtenir rapidement une estimation sur les 12 mois
* une année complète de données horaires utilisée par la simulation annuelle

Les données solaires sont transformées pour tenir compte de l'orientation et de l'inclinaison des panneaux ainsi que des profils d'ombrage.

### 2. Matériel

Base de données des équipements utilisés par les simulations :

* panneaux photovoltaïques
* onduleurs
* batteries

Chaque matériel possède notamment une marque, un modèle et un prix.

Les panneaux comportent leur taille, leur puissance et leur rendement.

Les onduleurs comportent leur rendement.

Les batteries comportent leur capacité, leur puissance maximale de charge/décharge, leurs différents rendements et leur SoC garanti avec nombre de cycles associé.

La base fournie constitue une base de départ et peut être enrichie directement dans l'application par ajout ou duplication de matériels.

La base matériel peut également être extraite dans un fichier séparé puis réimportée.

### 3. Installation

Création de profils d'installation à partir des équipements de la base matériel.

Pour chaque installation, il est possible de définir :

* le nombre et le modèle de panneaux
* l'onduleur
* la batterie
* l'orientation des panneaux (0° = plein sud)
* l'inclinaison (0° = horizontal)
* le profil d'ombrage
* la stratégie de charge et de décharge de la batterie
* les différents coûts complémentaires
* le choix de la revente du surplus ou non

Les coûts complémentaires sont librement ajoutables : pose, coffret de protection DC, frais administratifs, etc.

Une installation correspond actuellement à un seul groupe de panneaux avec une orientation et une inclinaison uniques.

### Stratégie batterie

La stratégie de batterie permet notamment de définir :

* la priorité entre alimentation de la maison et charge de la batterie lors de la production solaire
* les conditions de recharge : solaire seul, solaire + heures creuses ou solaire + plage horaire
* les conditions de décharge : dès que possible ou uniquement en heures pleines
* le SoC minimal à ne pas dépasser

Les puissances maximales de charge et de décharge sont définies dans la fiche de la batterie.

Les différents chemins d'énergie et leurs rendements sont simulés, notamment le fonctionnement des batteries AC pouvant suivre le chemin `PV → maison → batterie → maison`.

### Rendements

Les rendements définis dans la base matériel sont ensuite appliqués aux différents flux d'énergie.

### 4. Consommation

Gestion de profils de consommation à partir de données au pas de **15 minutes**.

* Importation de données de consommation
* Création manuelle de profils journaliers
* Utilisation libre de plusieurs profils journaliers
* Construction d'un profil annuel mois par mois
* Pour chaque mois, choix du nombre de jours utilisant chaque profil journalier
* Génération automatique des **365 fichiers journaliers**, chacun contenant 96 valeurs de consommation au pas de 15 minutes

Les profils de consommation ne distinguent pas directement les heures pleines et les heures creuses : les plages HP/HC sont définies dans l'onglet Localisation.

### 5. Simulation

Simulation du fonctionnement d'une installation à partir d'un profil de consommation journalier.

La simulation est effectuée sur trois journées représentatives :

* solstice d'hiver
* équinoxe
* solstice d'été

La même installation et le même profil de consommation sont utilisés pour les trois journées.

Le SoC initial de la batterie peut être défini par l'utilisateur.

Les résultats comprennent notamment les courbes de :

* consommation
* production solaire
* SoC de la batterie
* injection sur le réseau

Un rapport fournit également la consommation et son coût en HP, HC et au total.

Les orientations, inclinaisons, ombrages et rendements des différents équipements sont pris en compte dans les calculs.


### 6. Bilan financier

Simulation complète sur les **365 jours** du profil annuel.

Le bilan présente :

* prix des panneaux, onduleur, batterie et autres coûts
* coût total de l'installation
* taux d'autoconsommation
* taux d'autoproduction
* économie annuelle réalisée
* économie liée à la revente du surplus
* retour sur investissement
* consommation initiale et coût HP/HC mois par mois

Pour chaque mois, un graphique présente la production solaire ainsi que la répartition de l'énergie consommée entre solaire direct, batterie et réseau.

Le bilan fournit également :

* production annuelle estimée
* économie maximale théorique si toute la production était autoconsommée
* production annuelle simulée
* production annuelle consommée
* production annuelle injectée ou perdue

Des courbes quotidiennes sur les 365 jours permettent de suivre :

* l'énergie solaire consommée
* le pic de SoC
* le creux de SoC
* le SoC moyen

Le retour sur investissement actuel est calculé simplement à partir du **coût de l'installation et de l'économie annuelle réalisée**.

## Utilisation

L'application fonctionne directement dans un navigateur :

1. ouvrir `index.html`
2. définir la localisation et les paramètres énergétiques
3. choisir ou créer le matériel
4. créer une ou plusieurs installations
5. définir les profils de consommation
6. lancer les simulations
7. consulter le bilan financier

Aucune installation ni serveur local n'est nécessaire.

Les fonctions nécessitant des données externes, notamment le géocodage et PVGIS, nécessitent une connexion Internet. Le reste de l'application fonctionne hors ligne.

## Sauvegarde des projets

L'ensemble du projet peut être enregistré et rechargé sous la forme d'un **fichier JSON**.

Ce fichier contient également la base de données matériel.

La base matériel peut être extraite séparément afin de pouvoir être sauvegardée, partagée ou réimportée indépendamment d'un projet.

## Notes techniques

* Application web autonome fonctionnant directement depuis `index.html`
* Pas de dépendance à un serveur pour le fonctionnement courant
* Chart.js est embarqué localement
* Les bases de données sont gérées côté application
* L'état complet du projet est centralisé dans un fichier JSON lors des sauvegardes

## Évolutions prévues

Certaines fonctionnalités sont prévues mais ne sont pas encore implémentées :

* export des résultats en PDF
* simulation pluriannuelle
* évolution des tarifs de l'électricité
* vieillissement de la batterie
* prise en compte du remplacement de la batterie
