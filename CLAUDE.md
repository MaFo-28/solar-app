# Projet : Calcul de rentabilité panneaux solaires

## Objectif

Application web locale permettant de simuler une installation photovoltaïque complète et d'en évaluer la rentabilité en fonction :

* de la localisation et des données solaires ;
* des caractéristiques de l'installation ;
* du matériel et de ses rendements ;
* des habitudes de consommation ;
* des tarifs d'électricité ;
* de la stratégie de charge et de décharge de la batterie.

L'application est destinée à fonctionner directement dans un navigateur, sans serveur local ni installation particulière.

---

## Contraintes générales

* Application web autonome, lançable directement depuis `index.html`.
* Le projet doit pouvoir être zippé et transmis à un autre utilisateur sans configuration lourde.
* Toute l'IHM (libellés, textes, messages) doit être en français.
* Le code (variables, fonctions, commentaires, noms de fichiers) peut être en anglais.
* Ne pas ajouter de dépendance ou de service externe sans nécessité.
* Les données externes utilisées actuellement sont notamment PVGIS et le géocodage.
* Le reste de l'application doit fonctionner hors ligne lorsque les données nécessaires sont déjà disponibles.
* Bonne ergonomie : onglets, sections clairement identifiées, champs numériques, cases à cocher et graphiques.

---

# Structure fonctionnelle

L'application comporte actuellement 6 onglets :

1. Localisation
2. Matériel
3. Installation
4. Consommation
5. Simulation
6. Bilan financier

---

## 1. Localisation

Cet onglet regroupe les paramètres liés au lieu et aux tarifs :

* localisation par adresse ou coordonnées GPS ;
* données solaires PVGIS ;
* année PVGIS utilisée pour la simulation annuelle ;
* tarifs HP/HC ;
* tarif de revente du surplus ;
* profils d'ombrage.

### PVGIS

Deux types de données PVGIS sont utilisés :

* une moyenne mensuelle pour l'affichage rapide de la production théorique ;
* une année complète de données horaires pour la simulation annuelle.

Les données solaires sont transformées pour tenir compte :

* de l'orientation des panneaux ;
* de leur inclinaison ;
* des profils d'ombrage.

L'année utilisée pour la simulation annuelle peut être choisie parmi les années disponibles, actuellement 2005 à 2023.

### Ombrage

Un profil d'ombrage définit notamment :

* un angle de début par rapport au sud ;
* un angle de fin par rapport au sud ;
* une hauteur d'obstacle.

Une calculette permet de recalculer l'élévation d'un obstacle lorsque la position utilisée pour mesurer l'obstacle ne correspond pas à la position réelle de l'installation.

L'ombrage est réellement intégré aux calculs de production et pas uniquement affiché graphiquement.

---

## 2. Matériel

L'application possède une base de données locale regroupant :

* panneaux photovoltaïques ;
* onduleurs ;
* batteries.

Chaque matériel possède notamment une marque, un modèle et un prix.

### Panneaux

Les caractéristiques comprennent notamment :

* dimensions ;
* puissance ;
* rendement ;
* dégradation annuelle lorsque cette donnée est utilisée par l'installation.

### Onduleurs

Les caractéristiques comprennent notamment :

* rendement.

### Batteries

Les caractéristiques comprennent notamment :

* capacité ;
* puissance maximale de charge ;
* puissance maximale de décharge ;
* rendements associés aux différents flux ;
* SoC garanti ;
* nombre de cycles associé au SoC garanti.

Les rendements sont importants : ils doivent être pris en compte dans les calculs des flux d'énergie et ne doivent pas être ignorés ou remplacés par une valeur idéale de 100 %.

La base fournie constitue une base de départ. L'utilisateur peut l'enrichir directement dans l'application, notamment par ajout ou duplication de matériels.

La base matériel peut également être extraite séparément puis réimportée.

---

## 3. Installation

Un profil d'installation constitue une configuration complète utilisant les équipements de la base matériel.

L'onglet Installation est géré comme une base de données, au même titre que Matériel et Consommation.

### Profil d'installation

Chaque installation définit notamment :

* le modèle et le nombre de panneaux ;
* l'onduleur ;
* la batterie ;
* l'orientation des panneaux (0° = plein sud) ;
* l'inclinaison des panneaux (0° = horizontal) ;
* le profil d'ombrage ;
* la dégradation annuelle des panneaux ;
* la stratégie de charge de la batterie ;
* la stratégie de décharge de la batterie ;
* la stratégie de vente du surplus ;
* les coûts complémentaires.

Une installation correspond actuellement à **un seul groupe de panneaux**, avec une orientation et une inclinaison uniques.

Une seule batterie est actuellement possible par installation.

### Prix de l'installation

Le prix est calculé dynamiquement à partir des éléments de l'installation :

* Panneaux ;
* Onduleur ;
* Batterie ;
* Autre ;
* Total.

Les coûts complémentaires sont librement ajoutables.

Exemples :

* pose ;
* coffret de protection DC ;
* frais administratifs ;
* autres frais ou réductions.

Un coût négatif est autorisé afin de représenter par exemple une remise ou une réduction liée à un achat groupé.

### Stratégie batterie

La stratégie de batterie permet notamment de définir :

* la priorité entre alimentation de la maison et charge de la batterie lors de la production solaire ;
* les conditions de recharge :

  * solaire seul ;
  * solaire + heures creuses ;
  * solaire + plage horaire ;
* les conditions de décharge :

  * dès que possible ;
  * uniquement en heures pleines ;
* le SoC minimal à ne pas dépasser.

Les puissances maximales de charge et de décharge sont définies dans la fiche de la batterie.

Les différents chemins d'énergie doivent être correctement modélisés, y compris les batteries AC.

Exemple de chemin possible :

`PV → maison → batterie → maison`

Les rendements correspondant à chaque conversion doivent être appliqués.

---

## 4. Consommation

Les profils de consommation sont basés sur des données au pas de **15 minutes**.

Un profil journalier contient donc 96 valeurs.

L'utilisateur peut :

* importer des données de consommation ;
* créer manuellement des profils journaliers ;
* utiliser plusieurs profils journaliers ;
* construire un profil annuel mois par mois.

### Calendrier annuel

Pour chaque mois, l'utilisateur définit le nombre de jours associés à chaque profil journalier.

Le nombre de jours affectés doit correspondre au nombre réel de jours du mois.

Le calendrier permet ensuite de générer automatiquement les **365 fichiers journaliers**, chacun contenant 96 valeurs de consommation au pas de 15 minutes.

Les profils de consommation ne distinguent pas directement HP et HC.

Les plages HP/HC sont définies dans l'onglet Localisation et sont appliquées lors des calculs.

---

## 5. Simulation

La simulation permet d'analyser le fonctionnement d'une installation sur des journées représentatives.

La configuration actuelle utilise :

* une installation ;
* un profil de consommation ;
* un SoC initial de batterie.

Trois journées représentatives sont simulées :

* solstice d'hiver ;
* équinoxe ;
* solstice d'été.

Les calculs prennent en compte :

* la production solaire ;
* orientation et inclinaison ;
* ombrage ;
* puissance des équipements ;
* rendements ;
* consommation ;
* tarifs HP/HC ;
* stratégie de batterie ;
* SoC minimal ;
* puissance maximale de charge/décharge.

Les résultats comprennent notamment :

* consommation ;
* production solaire ;
* SoC de la batterie ;
* énergie injectée sur le réseau ;
* consommation et coût en HP ;
* consommation et coût en HC ;
* consommation et coût total.

Le moteur de simulation constitue une partie importante du projet : **ne pas modifier sa logique sans comprendre les flux d'énergie existants et leurs rendements.**

---

## 6. Bilan financier

Le bilan financier effectue une simulation complète sur les **365 jours du profil annuel**.

Il présente notamment :

### Coût de l'installation

* panneaux ;
* onduleur ;
* batterie ;
* autres coûts ;
* coût total.

### Résultats énergétiques et financiers

* taux d'autoconsommation ;
* taux d'autoproduction ;
* économie annuelle ;
* économie liée à la revente du surplus ;
* retour sur investissement.

Le coût initial de consommation est également présenté mois par mois avec :

* consommation HP ;
* consommation HC ;
* consommation totale ;
* coût HP ;
* coût HC ;
* coût total.

### Production et consommation

Pour chaque mois, un graphique présente :

* la production solaire ;
* l'énergie consommée directement depuis le solaire ;
* l'énergie fournie par la batterie ;
* l'énergie fournie par le réseau.

Le bilan fournit également :

* production annuelle théorique estimée ;
* économie maximale théorique si toute la production était autoconsommée ;
* production annuelle simulée ;
* production annuelle consommée ;
* production annuelle injectée ou perdue.

Des courbes quotidiennes sur les 365 jours permettent de suivre :

* l'énergie solaire consommée ;
* le pic de SoC ;
* le creux de SoC ;
* le SoC moyen.

### ROI

Le retour sur investissement actuel est volontairement simple :

`coût de l'installation / économie annuelle`

Ne pas introduire de modèle pluriannuel ou financier plus complexe sans demande explicite.

---

# Bandeau supérieur

Le bandeau « Rentabilité solaire » reste visible en permanence au-dessus des onglets.

Il gère le projet dans son ensemble et est indépendant du contenu des onglets.

Il doit notamment contenir les fonctions de gestion du projet :

* Ouvrir ;
* Enregistrer ;
* Enregistrer sous.

Le nom du projet doit être affiché au centre du bandeau.

### Gestion des fichiers

* Si un projet est déjà ouvert, « Enregistrer » écrase le fichier existant.
* Si aucun projet n'est encore associé à un fichier, « Enregistrer » ouvre la boîte de dialogue de sauvegarde.
* « Enregistrer sous » permet de choisir un nouveau nom de projet.

---

# Sauvegarde des projets

L'état complet du projet peut être sauvegardé dans un fichier JSON puis rechargé.

Le fichier de projet contient également la base de données matériel.

La base matériel peut être extraite séparément afin d'être :

* sauvegardée ;
* partagée ;
* réimportée indépendamment d'un projet.

Ne pas modifier le format des données sauvegardées sans vérifier les conséquences sur les projets existants.

---

# Principes importants du moteur de simulation

Le moteur doit représenter les flux d'énergie réels de manière cohérente.

En particulier :

* ne pas supposer un rendement de 100 % ;
* respecter les puissances maximales de charge et de décharge des batteries ;
* respecter le SoC minimal configuré ;
* appliquer les rendements aux conversions concernées ;
* tenir compte des stratégies de charge et de décharge ;
* distinguer consommation directe, énergie provenant de la batterie, énergie provenant du réseau et surplus injecté/perdu ;
* appliquer les tarifs HP/HC aux bons créneaux.

Les limitations de puissance des équipements sont des contraintes physiques de la simulation et ne doivent pas être contournées simplement pour obtenir un meilleur résultat financier.

Lors d'une modification du moteur, conserver la cohérence des flux existants et vérifier les résultats sur plusieurs situations représentatives.

---

# Conventions de travail

## Diffs minimaux

* Ne modifier que ce qui est nécessaire pour la demande en cours.
* Ne pas réorganiser ou reformater massivement le code existant sans demande explicite.
* Préserver les commentaires existants sauf lorsqu'ils deviennent faux.
* Ne pas toucher aux fonctions non concernées par la demande, même si elles semblent améliorables.

## Ne pas inventer

* Ne pas inventer de code, de format de données ou de dépendance.
* Si une information nécessaire manque, demander plutôt que supposer.
* Respecter les structures de données déjà utilisées par l'application.

## Diagnostic

Avant de conclure à un bug ou à une cause racine :

* examiner le comportement réel ;
* utiliser les logs ou messages d'erreur disponibles ;
* vérifier les données concernées ;
* reproduire le problème lorsque c'est possible.

Ne pas présenter une hypothèse comme une cause racine sans preuve concrète.

## Modifications du moteur

Le moteur de simulation est une partie sensible du projet.

Avant de modifier son comportement :

1. comprendre le flux d'énergie concerné ;
2. identifier les fonctions réellement responsables ;
3. vérifier les données d'entrée et de sortie ;
4. effectuer la modification la plus limitée possible ;
5. vérifier qu'elle ne modifie pas les autres chemins de calcul.

---

# Git

Le projet est versionné avec git.

### Commits

Utiliser **un commit par étape logique**.

Exemples :

* ajout de l'onglet Installation ;
* déplacement du calendrier vers Consommation ;
* modification indépendante du moteur de simulation.

Les messages de commit doivent être :

* concis ;
* à l'impératif ;
* en français.

Exemple :

`Ajoute l'onglet Installation avec section Prix`

### Validation obligatoire

**Ne jamais effectuer de `git commit` sans validation explicite de l'utilisateur.**

Lorsqu'une étape est terminée, proposer le commit et attendre la validation avant de l'exécuter.

**Ne jamais effectuer de `git push` sans demande explicite de l'utilisateur.**

Le dépôt reste local pour l'instant.

---

# Style de travail avec Claude Code

* Aller à l'essentiel.
* Privilégier les modifications ciblées.
* Avant une modification importante, identifier les fichiers et fonctions concernés.
* Ne pas refactorer du code simplement parce qu'une autre organisation semble préférable.
* Préserver le fonctionnement existant hors du périmètre de la demande.
* Lorsque plusieurs solutions sont possibles, privilégier celle qui nécessite le moins de modifications du code existant.
* En cas d'incertitude sur le comportement attendu, demander une précision plutôt que choisir arbitrairement.
