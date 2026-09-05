/**
 * project-header.js
 * Boutons de gestion de projet dans l'en-tête global (charger,
 * enregistrer, enregistrer sous) et affichage du nom du fichier
 * actuellement ouvert. Vit hors des onglets puisqu'il s'applique à
 * toute l'application, pas à un onglet en particulier.
 */
window.ProjectHeader = (function () {
  "use strict";

  function init() {
    refreshProjectName();
    bindSave();
    bindSaveAs();
    bindLoad();
  }

  function refreshProjectName() {
    const el = document.getElementById("header-project-name");
    const name = window.AppState.getCurrentFileName();
    el.textContent = name || "projet non enregistré";
  }

  function showStatus(message) {
    const el = document.getElementById("header-save-status");
    el.textContent = message;
    el.classList.add("is-visible");
    setTimeout(() => el.classList.remove("is-visible"), 2500);
  }

  function bindSave() {
    document.getElementById("btn-save-project").addEventListener("click", async function () {
      const result = await window.AppState.saveProject(false);
      if (result.saved) {
        showStatus("Enregistré : " + result.filename);
        refreshProjectName();
      } else {
        showStatus("Enregistrement annulé.");
      }
    });
  }

  function bindSaveAs() {
    document.getElementById("btn-save-as-project").addEventListener("click", async function () {
      const result = await window.AppState.saveProject(true);
      if (result.saved) {
        showStatus("Enregistré sous : " + result.filename);
        refreshProjectName();
      } else {
        showStatus("Enregistrement annulé.");
      }
    });
  }

  function bindLoad() {
    document.getElementById("btn-load-project").addEventListener("click", async function () {
      // essaie d'abord la boîte de dialogue native (Chrome/Edge/Opera) ;
      // si l'API n'existe pas dans ce navigateur, bascule sur l'input
      // fichier classique (Firefox, Safari)
      try {
        const result = await window.AppState.loadProjectViaPicker();
        if (result === null) {
          document.getElementById("load-project-input").click();
          return;
        }
        if (result.loaded) {
          showStatus("Projet chargé : " + result.filename);
          refreshProjectName();
          window.App.refreshAllTabs();
        }
      } catch (err) {
        showStatus("Erreur : fichier de projet invalide.");
        console.warn(err);
      }
    });

    document.getElementById("load-project-input").addEventListener("change", function (e) {
      const file = e.target.files[0];
      if (!file) return;
      window.AppState.loadProjectFromFile(file, function (err) {
        if (err) {
          showStatus("Erreur : fichier de projet invalide.");
        } else {
          showStatus("Projet chargé : " + file.name);
          refreshProjectName();
          window.App.refreshAllTabs();
        }
      });
      e.target.value = ""; // permet de recharger le même fichier deux fois de suite
    });
  }

  return { init, refreshProjectName };
})();
