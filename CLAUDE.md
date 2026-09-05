# Projet : Calcul de rentabilité panneaux solaires

## Objectif
Application web locale permettant de calculer la rentabilité de l'installation de
panneaux solaires (avec ou sans batterie), en fonction de la localisation, des
habitudes de consommation, et du matériel/prix choisi.

## Contraintes générales
- Application web, destinée à tourner en local (pas de déploiement en ligne
  requis) — doit pouvoir être zippée et lancée par quelqu'un d'autre sans
  configuration lourde.
- Toute l'IHM (libellés, textes, messages) doit être en français.
- Le code (variables, commentaires, noms de fichiers) peut être en anglais.
- Bonne ergonomie : onglets, cases à cocher, champs numériques, tracé de courbes.

## Bandeau supérieur "Rentabilité solaire"
Un bandeau reste visible en permanence en haut de la page, au-dessus des 5
onglets. Il gère le projet dans son ensemble (indépendant du contenu des
onglets).

**Demande faite (déjà en partie présente dans l'app, à vérifier/finaliser) :**
- Sortir les boutons "Charger" et "Enregistrer" de l'onglet Localisation.
- Les repositionner dans le bandeau "Rentabilité solaire", en haut à droite.
- Ajouter un bouton "Enregistrer sous" permettant de changer le nom du projet.
- Comportement du bouton "Enregistrer" :
  - Si un projet est déjà ouvert → écrase le fichier existant.
  - Sinon → ouvre la fenêtre de dialogue de sauvegarde.
- Afficher le nom du projet, **centré**, dans le bandeau "Rentabilité solaire".

## Structure actuelle (5 onglets)

### 1. Localisation
Lat/long, angles/élévation solaires aux solstices, ombre, PVGIS, tarifs élec
HC/HP, boutons load/save.

### 2. Matériel
Base de données pour panneaux, onduleurs et batteries.

### 3. Consommation
Base de données des profils de consommation, avec affichage des courbes de
consommation et de coût.

**Refonte en cours sur cet onglet :**
- La section "Calendrier de consommation" doit être déplacée ici (venant
  d'ailleurs dans l'app).
- Afficher les coûts de l'année (Heure Creuse, Heure Pleine, Total) en début
  de section, pour permettre d'affiner les jours et se rapprocher du coût réel.

### 4. Simulation (cible simplifiée après refonte)
- Sélection du Profil d'installation
- Affichage Production horaire théorique
- Sélection du Profil de consommation
- Niveau de charge de début (%) et de fin (%) de la batterie
- Affichage des Résultats

### 5. Bilan financier (cible après refonte)
- Sélection du Profil d'installation
- Affichage Production mensuelle réaliste (PVGIS)
- Affichage Dégradation dans le temps

## Refonte en cours (non terminée) — nouvel onglet "Installation"

Un nouvel onglet **Installation** doit être créé, géré comme une base de
données au même titre que les onglets Matériel et Consommation.

Structure cible de cet onglet :

1. **Section "Profil d'installation"** — en tête, avec les 4 boutons de
   gestion standard (comme les autres BDD de l'app).

2. **Section "Prix de l'installation"** — mise à jour dynamiquement en
   fonction des autres sections de l'onglet. Affiche : Panneaux, Onduleur,
   Batterie, Autre, Total. Doit être visuellement mis à l'écart pour bien le
   voir.

3. **Sections reprises depuis l'onglet Simulation actuel** (à déplacer telles
   quelles, sauf mention contraire) :
   - Installation (voir reprise ci-dessous)
   - Stratégie de charge de la batterie
   - Stratégie de décharge de la batterie — **sans** la partie "Niveau de
     charge de début (%) et de fin (%)" (qui reste dans Simulation)
   - Stratégie de vente du surplus

4. **Reprise de la section "Installation"** (renommée "Choix du matériel") :
   - Renommer "Installation" → **"Choix du matériel"**
   - Supprimer le texte "— c'est la config utilisée ici et dans le Bilan
     financier"
   - Supprimer la case "Nombre" pour la batterie : une seule batterie
     possible par installation ; pour plus de capacité, créer une autre
     batterie dans l'onglet Matériel
   - Réorganiser les champs :
     - Ligne 1 (Panneaux) : modèle, nombre, dégradation annuelle
     - Ligne 2 (Panneaux) : orientation, inclinaison, profil d'ombre
     - Ligne Onduleur
     - Ligne Batterie

5. **Nouvelle section "Coût fixe"** — lignes libellé + prix, ajoutables
   librement. Un prix négatif est autorisé (ex. "Pack -150€" pour une
   réduction liée à l'achat groupé d'éléments).

**Après cette refonte**, un nouveau sujet sera à traiter : affichage des
coûts, économies, ROI, etc. — pas encore défini, ne pas anticiper.

## Conventions de travail (important)
- **Diffs minimaux** : ne modifie que ce qui est nécessaire pour la demande en
  cours. Ne réorganise pas les blocs de code existants sans qu'on le demande
  explicitement.
- **Préserve les commentaires existants**, sauf s'ils deviennent faux suite à
  une modification.
- **Ne touche pas aux fonctions non concernées** par la demande, même si elles
  te semblent améliorables.
- **N'invente pas de code ou de dépendances** : si une info manque (ex. un
  format de données PVGIS, une lib à utiliser), demande plutôt que de supposer.
- Avant de conclure à un bug ou une cause racine, base-toi sur des preuves
  concrètes (logs, messages d'erreur, comportement observé) plutôt que sur une
  hypothèse.

## Style de réponse attendu
- Va à l'essentiel : diffs, code, ou explication technique ciblée plutôt que
  de longues reformulations.

## Git
Le projet est versionné avec git. Conventions à respecter :
- **Un commit par étape logique** de la refonte en cours (ex. un commit pour
  l'onglet Installation, un autre pour le déplacement du calendrier dans
  Consommation), plutôt qu'un seul gros commit en fin de tâche.
- **Message de commit concis**, à l'impératif, en français
  (ex. `Ajoute l'onglet Installation avec section Prix`)
- **Ne jamais committer sans validation explicite** : chaque `git commit` doit
  m'être proposé avant exécution, comme toute autre commande.
- **Ne pas faire de `git push`** sans demande explicite de ma part (le dépôt
  reste local pour l'instant).