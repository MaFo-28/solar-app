/**
 * state.js
 *
 * Etat central unique de l'application (AppState). Chaque onglet lit
 * et modifie ce même objet plutôt que de gérer son propre état
 * isolé — ça garantit la cohérence entre onglets (ex : la position
 * solaire calculée en onglet 1 est réutilisée en onglet 2) et rend
 * le save/load trivial : un seul objet à sérialiser.
 *
 * Persistance :
 *  - autosave silencieux dans localStorage à chaque changement
 *  - export/import explicite vers un fichier .json (boutons "load"/"save"
 *    de l'onglet Localisation), pour partager un projet avec quelqu'un
 *    d'autre sans dépendre du navigateur.
 */

window.AppState = (function () {
  "use strict";

  const STORAGE_KEY = "solar-app-state-v1";

  /**
   * Fabrique un profil d'installation vierge. Un profil regroupe tout
   * ce qui définit une installation concrète : le matériel choisi
   * (parmi les bases de l'onglet Matériel), les stratégies de charge /
   * décharge / vente, et les coûts fixes additionnels. Gérés comme une
   * base de données (onglet Installation), ils permettent de comparer
   * plusieurs configurations sans qu'elles se marchent dessus.
   *
   * Une seule batterie par profil : pour plus de capacité, on crée une
   * batterie de plus grande capacité dans l'onglet Matériel.
   */
  function createInstallationProfile(id, name) {
    return {
      id,
      name,
      panels: {
        selectedModelId: null,
        count: 1,
        orientation: 0,          // azimut du panneau, 0=Sud dans notre convention d'affichage
        tilt: 30,                // inclinaison en degrés / horizontale
        horizonMaskProfileId: null, // id d'un profil de location.horizonMaskProfiles, ou null = pas de masquage
        degradationPerYear: 0.5, // % / an
      },
      inverter: {
        selectedModelId: null, // null = "Aucun"
      },
      battery: {
        selectedModelId: null, // null = "Aucune"
      },
      chargeStrategy: {
        mode: "surplus", // "surplus" (uniquement l'excédent) | "priority" (batterie chargée avant la maison)
        gridChargeMode: "off", // "off" | "hc" (recharge depuis le réseau en heures creuses)
        maxSocPct: 100, // limite haute de charge, %
      },
      dischargeStrategy: {
        mode: "asap", // "asap" | "hp" (heures pleines uniquement) | "schedule" (plage horaire dédiée)
        scheduleStartHour: 18,
        scheduleEndHour: 22,
        minSocPct: 20, // limite basse de décharge, %
      },
      sellMode: "sell", // "sell" (revente au tarif défini) | "zero" (0 injection, surplus perdu) | "free" (injection gratuite)
      // Lignes libellé + prix libres (pose, câblage, démarches...).
      // Un prix négatif est permis, pour modéliser une remise liée à
      // l'achat groupé d'éléments (ex. "Pack" à -150 €).
      fixedCosts: [],
    };
  }

  function defaultState() {
    return {
      version: 1,
      // Base de données panneaux éditable, sauvegardée/chargée avec le
      // projet. Initialisée avec les modèles d'exemple d'usine
      // (js/data-panels.js), mais l'utilisateur peut ensuite l'éditer,
      // ajouter ou retirer des modèles librement.
      panelsDatabase: (window.PanelsDB || []).map((p) => Object.assign({}, p)),
      invertersDatabase: (window.InvertersDB || []).map((p) => Object.assign({}, p)),
      batteriesDatabase: (window.BatteriesDB || []).map((p) => Object.assign({}, p)),
      location: {
        label: "",           // adresse ou nom saisi par l'utilisateur
        lat: null,
        lng: null,
        timezoneOffset: 1,   // UTC+1 (France, heure d'hiver) par défaut
        horizonThresholdDeg: 0, // seuil d'élévation pour lever/coucher : 0=horizon théorique, >0 pour modéliser un horizon masqué (bâti, relief, arbres)
        tariffs: [
          // plage horaire simple par défaut ; structure volontairement
          // flexible pour accueillir HC/HP, tempo, etc.
          { id: "hp", label: "Heures Pleines", startHour: 6, endHour: 22, pricePerKwh: 0.27 },
          { id: "hc", label: "Heures Creuses", startHour: 22, endHour: 6, pricePerKwh: 0.2068 },
        ],
        sellTariffPerKwh: 0.04, // prix de revente du surplus, €/kWh — valeur indicative à ajuster selon contrat
        pvgisCache: null,     // résultat brut PVGIS mis en cache après requête
        // Profils de masque d'horizon : plusieurs jeux d'obstacles
        // nommés (ex: "Sol", "Bas de toiture", "Haut de toiture"), car
        // un même obstacle proche n'a pas la même hauteur angulaire vue
        // depuis des points d'observation différents (parallaxe). Un
        // seul profil est affiché/édité à la fois pour rester lisible ;
        // les autres onglets pourront référencer un profil par son id
        // une fois leurs calculs de production branchés dessus.
        horizonMaskProfiles: [{ id: "profile-1", name: "Sol", mask: [] }],
        activeHorizonMaskProfileId: "profile-1",
      },
      panels: {
        selectedModelId: null,
        count: 1,
        orientation: 0,       // azimut du panneau, 0=Sud dans notre convention d'affichage (voir tab-panels)
        tilt: 30,              // inclinaison en degrés / horizontale
        degradationPerYear: 0.5, // % / an
        horizonMaskProfileId: null, // id d'un profil de location.horizonMaskProfiles, ou null = pas de masquage
      },
      inverter: {
        selectedModelId: null,
        count: 1,
      },
      battery: {
        selectedModelId: null,
        count: 1,
      },
      consumption: {
        // Profils de consommation nommés (ex: "Semaine", "Week-end",
        // "Été sans chauffage"), chacun défini par une liste de plages
        // horaires (début, fin, puissance en W) plutôt que 24 cases
        // fixes — même principe que le masque d'horizon. Un seul
        // profil est affiché/édité à la fois.
        profiles: [{ id: "consumption-profile-1", name: "Défaut", segments: [] }],
        activeProfileId: "consumption-profile-1",
      },
      // Base de données des installations (onglet Installation) : le
      // matériel installé et ses stratégies, hors de l'onglet
      // Simulation qui ne fait plus que choisir un profil et le
      // visualiser.
      installationProfiles: [createInstallationProfile("install-profile-1", "Installation 1")],
      activeInstallationProfileId: "install-profile-1",
      // Onglet Simulation : uniquement les choix propres à la
      // simulation (quel profil d'installation, quel profil de
      // consommation, niveau de charge de la batterie en début de
      // journée) — la config matériel/stratégies vit dans
      // installationProfiles.
      simulationConfig: {
        installationProfileId: "install-profile-1",
        consumptionProfileId: "consumption-profile-1",
        initialSocPct: 50, // niveau de charge au début de la journée simulée, %
      },
    };
  }

  /**
   * Fusionne un état chargé (localStorage ou fichier importé) avec
   * les valeurs par défaut. Indispensable dès que l'appli évolue :
   * un projet sauvegardé avec une version antérieure ne contient pas
   * les nouveaux champs (ex: horizonMask ajouté après coup) — sans
   * cette fusion, ces champs resteraient `undefined` et feraient
   * planter silencieusement les onglets qui les utilisent.
   */
  /**
   * Migration douce : un ancien masque enregistré avec un point unique
   * ({azimuthSouth, elevationDeg}) est converti en plage étroite
   * ({azimuthStart, azimuthEnd, elevationDeg}) de ±3° autour du point
   * d'origine, pour ne pas perdre la saisie de l'utilisateur lors du
   * passage au nouveau modèle "plage d'azimut".
   */
  function normalizeHorizonMaskEntry(entry) {
    if (entry && typeof entry.azimuthStart === "number" && typeof entry.azimuthEnd === "number") {
      return entry; // déjà au nouveau format
    }
    const center = entry && typeof entry.azimuthSouth === "number" ? entry.azimuthSouth : 0;
    const height = entry && typeof entry.elevationDeg === "number" ? entry.elevationDeg : 15;
    return { azimuthStart: center - 3, azimuthEnd: center + 3, elevationDeg: height };
  }

  function genId(prefix) {
    return prefix + "-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  /**
   * Migration douce : un projet enregistré avant l'introduction des
   * profils multiples (simple tableau `location.horizonMask`) est
   * enveloppé dans un unique profil "Sol", pour ne pas perdre les
   * obstacles déjà saisis.
   */
  function migrateHorizonProfiles(loadedLocation, defLocation) {
    if (
      loadedLocation &&
      Array.isArray(loadedLocation.horizonMaskProfiles) &&
      loadedLocation.horizonMaskProfiles.length > 0
    ) {
      const profiles = loadedLocation.horizonMaskProfiles.map((p) => ({
        id: p.id || genId("profile"),
        name: p.name || "Profil",
        mask: Array.isArray(p.mask) ? p.mask.map(normalizeHorizonMaskEntry) : [],
      }));
      const activeId =
        loadedLocation.activeHorizonMaskProfileId &&
        profiles.some((p) => p.id === loadedLocation.activeHorizonMaskProfileId)
          ? loadedLocation.activeHorizonMaskProfileId
          : profiles[0].id;
      return { horizonMaskProfiles: profiles, activeHorizonMaskProfileId: activeId };
    }
    if (loadedLocation && Array.isArray(loadedLocation.horizonMask)) {
      const mask = loadedLocation.horizonMask.map(normalizeHorizonMaskEntry);
      const id = genId("profile");
      return {
        horizonMaskProfiles: [{ id, name: "Sol", mask }],
        activeHorizonMaskProfileId: id,
      };
    }
    return {
      horizonMaskProfiles: defLocation.horizonMaskProfiles,
      activeHorizonMaskProfileId: defLocation.activeHorizonMaskProfileId,
    };
  }

  /**
   * Migration douce : un ancien profil de consommation à 24 cases
   * fixes (`consumption.hourlyProfileW`) est converti en plages
   * horaires (regroupe les heures consécutives de même puissance),
   * enveloppées dans un unique profil "Défaut", pour ne pas perdre la
   * saisie de l'utilisateur lors du passage au nouveau modèle.
   */
  function collapseHourlyToSegments(hourlyArr) {
    const segments = [];
    let i = 0;
    while (i < 24) {
      const power = hourlyArr[i] || 0;
      let j = i;
      while (j < 24 && (hourlyArr[j] || 0) === power) j++;
      if (power > 0) segments.push({ startHour: i, endHour: j, powerW: power });
      i = j;
    }
    return segments;
  }

  function migrateConsumptionProfiles(loadedConsumption, defConsumption) {
    if (
      loadedConsumption &&
      Array.isArray(loadedConsumption.profiles) &&
      loadedConsumption.profiles.length > 0
    ) {
      const profiles = loadedConsumption.profiles.map((p) => ({
        id: p.id || genId("consumption-profile"),
        name: p.name || "Profil",
        segments: Array.isArray(p.segments) ? p.segments : [],
      }));
      const activeId =
        loadedConsumption.activeProfileId &&
        profiles.some((p) => p.id === loadedConsumption.activeProfileId)
          ? loadedConsumption.activeProfileId
          : profiles[0].id;
      return { profiles, activeProfileId: activeId };
    }
    if (loadedConsumption && Array.isArray(loadedConsumption.hourlyProfileW)) {
      const segments = collapseHourlyToSegments(loadedConsumption.hourlyProfileW);
      const id = genId("consumption-profile");
      return { profiles: [{ id, name: "Défaut", segments }], activeProfileId: id };
    }
    return { profiles: defConsumption.profiles, activeProfileId: defConsumption.activeProfileId };
  }

  /**
   * Complète un profil d'installation chargé avec les champs par
   * défaut : même rôle que mergeWithDefaults, mais à l'échelle d'un
   * profil (un profil enregistré avant l'ajout d'un champ ne le
   * contient pas).
   */
  function normalizeInstallationProfile(loadedProfile) {
    const base = createInstallationProfile(
      loadedProfile.id || genId("install-profile"),
      loadedProfile.name || "Installation"
    );
    ["panels", "inverter", "battery", "chargeStrategy", "dischargeStrategy"].forEach((key) => {
      base[key] = Object.assign(base[key], loadedProfile[key] || {});
    });
    if (loadedProfile.sellMode) base.sellMode = loadedProfile.sellMode;
    if (Array.isArray(loadedProfile.fixedCosts)) base.fixedCosts = loadedProfile.fixedCosts;
    return base;
  }

  /**
   * Migration douce : un projet enregistré avant l'onglet Installation
   * décrivait une installation unique dans `strategy` (matériel +
   * stratégies de charge/décharge/vente). On la convertit en premier
   * profil d'installation pour ne pas perdre la config de
   * l'utilisateur.
   */
  function migrateInstallationProfiles(loaded, def) {
    if (Array.isArray(loaded.installationProfiles) && loaded.installationProfiles.length > 0) {
      const profiles = loaded.installationProfiles.map(normalizeInstallationProfile);
      const activeId =
        loaded.activeInstallationProfileId &&
        profiles.some((p) => p.id === loaded.activeInstallationProfileId)
          ? loaded.activeInstallationProfileId
          : profiles[0].id;
      return { installationProfiles: profiles, activeInstallationProfileId: activeId };
    }
    if (loaded.strategy) {
      const profile = normalizeInstallationProfile(
        Object.assign({ id: genId("install-profile"), name: "Installation 1" }, loaded.strategy)
      );
      return { installationProfiles: [profile], activeInstallationProfileId: profile.id };
    }
    return {
      installationProfiles: def.installationProfiles,
      activeInstallationProfileId: def.activeInstallationProfileId,
    };
  }

  /**
   * Choix propres à l'onglet Simulation. Reprend, pour un projet
   * d'avant l'onglet Installation, le niveau de charge initial et le
   * profil de consommation qui vivaient dans `strategy`.
   */
  function migrateSimulationConfig(loaded, def, profiles, consumptionProfiles) {
    const cfg = Object.assign({}, def.simulationConfig, loaded.simulationConfig || {});
    const legacy = loaded.strategy;
    if (!loaded.simulationConfig && legacy) {
      if (legacy.dischargeStrategy && typeof legacy.dischargeStrategy.initialSocPct === "number") {
        cfg.initialSocPct = legacy.dischargeStrategy.initialSocPct;
      }
      if (Array.isArray(legacy.consumptionProfileIds) && legacy.consumptionProfileIds[0]) {
        cfg.consumptionProfileId = legacy.consumptionProfileIds[0];
      }
    }
    if (!profiles.some((p) => p.id === cfg.installationProfileId)) {
      cfg.installationProfileId = profiles[0].id;
    }
    if (!consumptionProfiles.some((p) => p.id === cfg.consumptionProfileId)) {
      cfg.consumptionProfileId = consumptionProfiles.length > 0 ? consumptionProfiles[0].id : null;
    }
    return cfg;
  }

  function mergeWithDefaults(loaded) {
    const def = defaultState();
    if (!loaded || typeof loaded !== "object") return def;

    const merged = Object.assign({}, def, loaded);
    merged.panelsDatabase = Array.isArray(loaded.panelsDatabase) && loaded.panelsDatabase.length > 0
      ? loaded.panelsDatabase
      : def.panelsDatabase;
    merged.invertersDatabase = Array.isArray(loaded.invertersDatabase) && loaded.invertersDatabase.length > 0
      ? loaded.invertersDatabase
      : def.invertersDatabase;
    merged.batteriesDatabase = Array.isArray(loaded.batteriesDatabase) && loaded.batteriesDatabase.length > 0
      ? loaded.batteriesDatabase
      : def.batteriesDatabase;
    ["location", "panels", "inverter", "battery", "consumption"].forEach((key) => {
      merged[key] = Object.assign({}, def[key], loaded[key] || {});
    });
    // tableaux : on garde ceux de l'utilisateur s'ils existent, sinon le défaut
    merged.location.tariffs = Array.isArray(loaded.location && loaded.location.tariffs)
      ? loaded.location.tariffs
      : def.location.tariffs;
    const profileData = migrateHorizonProfiles(loaded.location, def.location);
    merged.location.horizonMaskProfiles = profileData.horizonMaskProfiles;
    merged.location.activeHorizonMaskProfileId = profileData.activeHorizonMaskProfileId;
    delete merged.location.horizonMask; // ancien champ, remplacé par horizonMaskProfiles

    const consumptionData = migrateConsumptionProfiles(loaded.consumption, def.consumption);
    merged.consumption.profiles = consumptionData.profiles;
    merged.consumption.activeProfileId = consumptionData.activeProfileId;
    delete merged.consumption.hourlyProfileW; // ancien champ, remplacé par profiles[].segments

    const installationData = migrateInstallationProfiles(loaded, def);
    merged.installationProfiles = installationData.installationProfiles;
    merged.activeInstallationProfileId = installationData.activeInstallationProfileId;
    merged.simulationConfig = migrateSimulationConfig(
      loaded, def, merged.installationProfiles, merged.consumption.profiles
    );
    delete merged.strategy; // ancien champ, remplacé par installationProfiles + simulationConfig

    return merged;
  }

  let state = mergeWithDefaults(loadFromLocalStorage());
  const listeners = [];

  function get() {
    return state;
  }

  function set(path, value) {
    const parts = path.split(".");
    let obj = state;
    for (let i = 0; i < parts.length - 1; i++) {
      obj = obj[parts[i]];
    }
    obj[parts[parts.length - 1]] = value;
    persistToLocalStorage();
    notify(path);
  }

  function onChange(fn) {
    listeners.push(fn);
  }

  function notify(path) {
    listeners.forEach((fn) => fn(path, state));
  }

  function persistToLocalStorage() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      console.warn("Impossible de sauvegarder automatiquement (localStorage) :", e);
    }
  }

  function loadFromLocalStorage() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      console.warn("Impossible de lire la sauvegarde locale :", e);
      return null;
    }
  }

  // ------------------------------------------------------------------
  // Gestion de fichier projet : suit le fichier actuellement ouvert
  // (nom + poignée native si le navigateur le permet) pour distinguer
  // "Enregistrer" (écrase le fichier déjà ouvert) de "Enregistrer sous"
  // (redemande toujours où sauver). La poignée (FileSystemFileHandle)
  // n'existe que sur Chrome/Edge/Opera (File System Access API) ; sur
  // les autres navigateurs, "Enregistrer" se comporte comme "Enregistrer
  // sous" à chaque fois — limitation du navigateur, pas de l'appli.
  // ------------------------------------------------------------------
  let currentFileHandle = null;
  let currentFileName = null;

  function getCurrentFileName() {
    return currentFileName;
  }

  /**
   * Enregistre le projet. Si un fichier est déjà ouvert (poignée
   * native disponible) ET que saveAs n'est pas demandé, écrase ce
   * fichier directement sans redemander. Sinon, ouvre la boîte de
   * dialogue "Enregistrer sous" (native si possible, sinon
   * téléchargement classique).
   *
   * Retourne { saved: bool, filename?: string }.
   */
  async function saveProject(saveAs) {
    const jsonStr = JSON.stringify(state, null, 2);
    const suggestedName = currentFileName || "projet-solaire.json";

    if (window.showSaveFilePicker) {
      try {
        let handle = currentFileHandle;
        if (saveAs || !handle) {
          handle = await window.showSaveFilePicker({
            suggestedName,
            types: [
              { description: "Projet solaire (JSON)", accept: { "application/json": [".json"] } },
            ],
          });
        }
        const writable = await handle.createWritable();
        await writable.write(jsonStr);
        await writable.close();
        currentFileHandle = handle;
        currentFileName = handle.name;
        return { saved: true, filename: currentFileName };
      } catch (err) {
        if (err && err.name === "AbortError") {
          return { saved: false };
        }
        console.warn("showSaveFilePicker en erreur, repli sur le téléchargement classique :", err);
      }
    }

    // Repli : téléchargement classique (Firefox, Safari, ou API indisponible).
    // Pas de poignée obtenue ici, donc le prochain "Enregistrer" redemandera.
    const blob = new Blob([jsonStr], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = suggestedName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    currentFileName = suggestedName;
    currentFileHandle = null;
    return { saved: true, filename: currentFileName };
  }

  /**
   * Charge un projet. Essaie d'abord la boîte de dialogue native
   * (Chrome/Edge/Opera), qui fournit une poignée réutilisable pour les
   * futurs "Enregistrer". Retourne null si l'API n'est pas disponible
   * (le bouton "Charger" doit alors basculer sur l'input fichier
   * classique, voir loadProjectFromFile).
   *
   * Retourne { loaded: bool, filename?: string } ou null si l'API
   * native n'existe pas dans ce navigateur.
   */
  async function loadProjectViaPicker() {
    if (!window.showOpenFilePicker) return null;
    try {
      const [handle] = await window.showOpenFilePicker({
        types: [{ description: "Projet solaire (JSON)", accept: { "application/json": [".json"] } }],
      });
      const file = await handle.getFile();
      const text = await file.text();
      const parsed = JSON.parse(text);
      state = mergeWithDefaults(parsed);
      persistToLocalStorage();
      currentFileHandle = handle;
      currentFileName = handle.name;
      notify("*");
      return { loaded: true, filename: currentFileName };
    } catch (err) {
      if (err && err.name === "AbortError") return { loaded: false };
      throw err;
    }
  }

  /**
   * Repli classique (Firefox, Safari) : charge un fichier choisi via
   * un <input type="file">. Aucune poignée obtenue, donc le prochain
   * "Enregistrer" redemandera où sauver.
   */
  function loadProjectFromFile(file, callback) {
    const reader = new FileReader();
    reader.onload = function (e) {
      try {
        const parsed = JSON.parse(e.target.result);
        state = mergeWithDefaults(parsed);
        persistToLocalStorage();
        currentFileHandle = null;
        currentFileName = file.name;
        notify("*");
        if (callback) callback(null, state);
      } catch (err) {
        if (callback) callback(err);
      }
    };
    reader.onerror = function (err) {
      if (callback) callback(err);
    };
    reader.readAsText(file);
  }

  // ------------------------------------------------------------------
  // Gestion de fichier "bibliothèque matériel" séparée du projet :
  // permet de partager/réutiliser les bases panneaux/onduleurs/
  // batteries indépendamment d'un projet complet. Même mécanisme de
  // poignée native que le projet (voir plus haut).
  // ------------------------------------------------------------------
  let currentMaterialFileHandle = null;
  let currentMaterialFileName = null;

  function getCurrentMaterialFileName() {
    return currentMaterialFileName;
  }

  async function saveMaterialLibrary(saveAs) {
    const payload = {
      panelsDatabase: state.panelsDatabase,
      invertersDatabase: state.invertersDatabase,
      batteriesDatabase: state.batteriesDatabase,
    };
    const jsonStr = JSON.stringify(payload, null, 2);
    const suggestedName = currentMaterialFileName || "bibliotheque-materiel.json";

    if (window.showSaveFilePicker) {
      try {
        let handle = currentMaterialFileHandle;
        if (saveAs || !handle) {
          handle = await window.showSaveFilePicker({
            suggestedName,
            types: [
              { description: "Bibliothèque matériel (JSON)", accept: { "application/json": [".json"] } },
            ],
          });
        }
        const writable = await handle.createWritable();
        await writable.write(jsonStr);
        await writable.close();
        currentMaterialFileHandle = handle;
        currentMaterialFileName = handle.name;
        return { saved: true, filename: currentMaterialFileName };
      } catch (err) {
        if (err && err.name === "AbortError") {
          return { saved: false };
        }
        console.warn("showSaveFilePicker en erreur, repli sur le téléchargement classique :", err);
      }
    }

    const blob = new Blob([jsonStr], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = suggestedName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    currentMaterialFileName = suggestedName;
    currentMaterialFileHandle = null;
    return { saved: true, filename: currentMaterialFileName };
  }

  /** Remplace les 3 bases par le contenu importé (avec migration légère si besoin). */
  function applyMaterialLibrary(parsed) {
    if (Array.isArray(parsed.panelsDatabase) && parsed.panelsDatabase.length > 0) {
      state.panelsDatabase = parsed.panelsDatabase;
    }
    if (Array.isArray(parsed.invertersDatabase) && parsed.invertersDatabase.length > 0) {
      state.invertersDatabase = parsed.invertersDatabase;
    }
    if (Array.isArray(parsed.batteriesDatabase) && parsed.batteriesDatabase.length > 0) {
      state.batteriesDatabase = parsed.batteriesDatabase;
    }
    persistToLocalStorage();
    notify("panelsDatabase");
    notify("invertersDatabase");
    notify("batteriesDatabase");
  }

  async function loadMaterialLibraryViaPicker() {
    if (!window.showOpenFilePicker) return null;
    try {
      const [handle] = await window.showOpenFilePicker({
        types: [{ description: "Bibliothèque matériel (JSON)", accept: { "application/json": [".json"] } }],
      });
      const file = await handle.getFile();
      const text = await file.text();
      const parsed = JSON.parse(text);
      applyMaterialLibrary(parsed);
      currentMaterialFileHandle = handle;
      currentMaterialFileName = handle.name;
      return { loaded: true, filename: currentMaterialFileName };
    } catch (err) {
      if (err && err.name === "AbortError") return { loaded: false };
      throw err;
    }
  }

  function loadMaterialLibraryFromFile(file, callback) {
    const reader = new FileReader();
    reader.onload = function (e) {
      try {
        const parsed = JSON.parse(e.target.result);
        applyMaterialLibrary(parsed);
        currentMaterialFileHandle = null;
        currentMaterialFileName = file.name;
        if (callback) callback(null);
      } catch (err) {
        if (callback) callback(err);
      }
    };
    reader.onerror = function (err) {
      if (callback) callback(err);
    };
    reader.readAsText(file);
  }

  function reset() {
    state = defaultState();
    persistToLocalStorage();
    notify("*");
  }

  return {
    get,
    set,
    onChange,
    reset,
    createInstallationProfile,
    getCurrentFileName,
    saveProject,
    loadProjectViaPicker,
    loadProjectFromFile,
    getCurrentMaterialFileName,
    saveMaterialLibrary,
    loadMaterialLibraryViaPicker,
    loadMaterialLibraryFromFile,
  };
})();
