/**
 * tab-visual.js
 * Permet de visualiser les fichiers exportés par BILAN FINANCIER
 */

window.TabVisualisation = (function () {
  "use strict";

  let visualData = [];
  let powerChart = null;

  function init() {
    selectFile();
  }

  function showStatus(message) {
    const el = document.getElementById("header-save-status");
    el.textContent = message;
    el.classList.add("is-visible");
    setTimeout(() => el.classList.remove("is-visible"), 2500);
  }
  // ------------------------------------------------------------------
  // Sélection du fichier
  // ------------------------------------------------------------------
  function selectFile() {
    const btn = document.getElementById("btn-import-file");
    const fileInput = document.getElementById("load-annual-file-input");
  
    if (!btn || !fileInput) return;
  
    btn.addEventListener("click", function () {
      fileInput.click();
    });
  
    fileInput.addEventListener("change", function (e) {
      const file = e.target.files[0]; // Bien prendre le premier fichier [0]
      if (!file) return;
  
      const reader = new FileReader();
      reader.onload = function (event) {
        try {
          // Analyse du CSV
          visualData = parseCsv(event.target.result);
		  
		  if (visualData.length > 0) {
		    updateDateRange();
		    renderResultChart("01-01", "01-07"); // Lance le graphique sur la première semaine par défaut
		  }
		  
          const info = document.getElementById("visual-file-info");
          if (info) {
            info.textContent = `${visualData.length} points importés`;
          }
  
        } catch (err) {
          console.error("Erreur lors de l'import CSV :", err);
        }
      };
  
      reader.readAsText(file, "UTF-8");
      e.target.value = ""; // Permet de ré-importer le même fichier si besoin
    });
  }

  // ------------------------------------------------------------------
  // Lecture du CSV
  // ------------------------------------------------------------------
  function parseCsv(text) {
    const lines = text
      .replace(/^\uFEFF/, "")
      .split(/\r?\n/)
      .filter(line => line.trim() !== "");

    if (lines.length < 2) {
      return [];
    }

    const headers = lines[0].split(";");

    return lines.slice(1).map(line => {
      const values = line.split(";");
      const row = {};

      headers.forEach((header, index) => {
        row[header] = values[index];
      });

      return {
        jour: row.jour,
        heure: row.heure,
        productionW: Number(row.productionW),
        consumptionW: Number(row.consumptionW),
        solarToHouseW: Number(row.solarToHouseW),
        batteryChargeW: Number(row.batteryChargeW),
        batteryDischargeW: Number(row.batteryDischargeW),
        gridImportW: Number(row.gridImportW),
        gridExportW: Number(row.gridExportW),
        socPct: Number(row.socPct)
      };
    });
  }

  // ------------------------------------------------------------------
  // Définit les dates disponibles
  // ------------------------------------------------------------------
function updateDateRange() {
  const selectDebJour = document.getElementById("visual-debut-jour");
  const selectDebMois = document.getElementById("visual-debut-mois");
  const selectDuree = document.getElementById("visual-duree-jours");
  const btnPrev = document.getElementById("visual-btn-prev");
  const btnNext = document.getElementById("visual-btn-next");

  if (!selectDebJour || !selectDebMois || !selectDuree || !btnPrev || !btnNext) return;

  const nomsMois = [
    "Janvier", "Février", "Mars", "Avril", "Mai", "Juin", 
    "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre"
  ];

  // 1. Remplissage initial des Mois et de la Durée
  let htmlMois = "";
  nomsMois.forEach((nom, index) => {
    htmlMois += `<option value="${String(index + 1).padStart(2, "0")}">${nom}</option>`;
  });
  selectDebMois.innerHTML = htmlMois;

  let htmlDuree = "";
  for (let i = 1; i <= 31; i++) {
    htmlDuree += `<option value="${i}">${i}</option>`;
  }
  selectDuree.innerHTML = htmlDuree;

  selectDebJour.disabled = false;
  selectDebMois.disabled = false;
  selectDuree.disabled = false;
  btnPrev.disabled = false;
  btnNext.disabled = false;

  // Valeurs initiales par défaut
  selectDebMois.value = "01";
  selectDuree.value = "7";

  function ajusterNombreDeJours() {
    const moisSelectionne = parseInt(selectDebMois.value, 10);
    const ancienneValeurJour = selectDebJour.value; // On mémorise le jour actuel
    
    // Calcul du nombre de jours max dans ce mois
    let maxJours = 31;
    if (moisSelectionne === 2) {
      maxJours = 28;
    } else if ([4, 6, 9, 11].includes(moisSelectionne)) {
      maxJours = 30;
    }

    let htmlJours = "";
    for (let i = 1; i <= maxJours; i++) {
      const val = String(i).padStart(2, "0");
      htmlJours += `<option value="${val}">${val}</option>`;
    }
    selectDebJour.innerHTML = htmlJours;

    // Si le jour précédemment choisi existe toujours, on le remet. 
    // Sinon (ex: on était le 31 et on passe sur Février), on le bloque au maximum du mois (ex: 28).
    if (parseInt(ancienneValeurJour, 10) <= maxJours) {
      selectDebJour.value = ancienneValeurJour;
    } else {
      selectDebJour.value = String(maxJours).padStart(2, "0");
    }
  }

  // Fonction principale de calcul et de rendu graphique
  function declencherRendu() {
    const jourInt = parseInt(selectDebJour.value, 10);
    const moisInt = parseInt(selectDebMois.value, 10) - 1;
    const nbJours = parseInt(selectDuree.value, 10);

    const dateDebut = new Date(2025, moisInt, jourInt);
    const dateFin = new Date(dateDebut);
    dateFin.setDate(dateDebut.getDate() + (nbJours - 1));

    const debutMMDD = `${String(dateDebut.getMonth() + 1).padStart(2, "0")}-${String(dateDebut.getDate()).padStart(2, "0")}`;
    const finMMDD = `${String(dateFin.getMonth() + 1).padStart(2, "0")}-${String(dateFin.getDate()).padStart(2, "0")}`;

    renderResultChart(debutMMDD, finMMDD);
  }

  // Logique du saut temporel pour les boutons fléchés
  function sauterPeriode(direction) {
    const jourInt = parseInt(selectDebJour.value, 10);
    const moisInt = parseInt(selectDebMois.value, 10) - 1;
    const nbJours = parseInt(selectDuree.value, 10);

    const nouvelleDate = new Date(2025, moisInt, jourInt);
    nouvelleDate.setDate(nouvelleDate.getDate() + (direction * nbJours));

    if (nouvelleDate.getFullYear() < 2025) {
      nouvelleDate.setFullYear(2025, 0, 1);
    } else if (nouvelleDate.getFullYear() > 2025) {
      nouvelleDate.setFullYear(2025, 11, 31);
    }

    const nouveauMoisStr = String(nouvelleDate.getMonth() + 1).padStart(2, "0");
    const nouveauJourStr = String(nouvelleDate.getDate()).padStart(2, "0");

    // Important : on change le mois d'abord, on ajuste les jours disponibles, puis on applique le jour
    selectDebMois.value = nouveauMoisStr;
    ajusterNombreDeJours();
    selectDebJour.value = nouveauJourStr;

    declencherRendu();
  }

  // Branchement des écouteurs d'événements
  selectDebMois.addEventListener("change", function() {
    ajusterNombreDeJours(); // Ajuste la liste de choix dès que le mois change
    declencherRendu();
  });
  
  selectDebJour.addEventListener("change", declencherRendu);
  selectDuree.addEventListener("change", declencherRendu);

  btnPrev.addEventListener("click", () => sauterPeriode(-1));
  btnNext.addEventListener("click", () => sauterPeriode(1));

  ajusterNombreDeJours();
}


  // ------------------------------------------------------------------
  // Affichage des courbes
  // ------------------------------------------------------------------
  function renderResultChart(jourDebut, jourFin) {
    const visualWrap = document.getElementById("panel-visual-chart-wrap");

    if (!jourDebut || !jourFin) {
      jourDebut = "01-01";
      jourFin = "01-07";
    }
  
    // Filtrage des données de manière chronologique continue
    const pointsFiltrés = visualData.filter(p => {
      if (jourDebut <= jourFin) {
        // Cas standard (ex: du 01-01 au 01-28)
        return p.jour >= jourDebut && p.jour <= jourFin;
      } else {
        // Cas à cheval sur le Nouvel An
        return p.jour >= jourDebut || p.jour <= jourFin;
      }
    });
  
    const labelsX = pointsFiltrés.map(p => `${p.jour} ${p.heure}`);
    const productionData = pointsFiltrés.map(p => p.productionW);
    const consumptionData = pointsFiltrés.map(p => p.consumptionW);
    const socData = pointsFiltrés.map(p => p.socPct);
  
    // Batterie = Décharge - Charge
    const batteryData = pointsFiltrés.map(p => p.batteryDischargeW - p.batteryChargeW);
    // Réseau = Import - Export
    const gridData = pointsFiltrés.map(p => p.gridImportW - p.gridExportW);

    const ctx2d = document.getElementById("visual-result-chart").getContext("2d");
    if (powerChart) powerChart.destroy();
    powerChart = new Chart(ctx2d, {
      type: "line",
      data: {
        labels: labelsX, // Tableau de chaînes "MM-DD HH:MM" à la suite
        datasets: [
          {
            label: "Production solaire (W)",
            data: productionData,
            borderColor: "#f5a623",
            backgroundColor: "rgba(245,166,35,0.24)",
            fill: false,
            pointRadius: 0,
            tension: 0.15,
          },
          {
            label: "Consommation (W)",
            data: consumptionData,
            borderColor: "#3ec9a7",
            backgroundColor: "rgba(62,201,167,0.24)",
            pointRadius: 0,
            tension: 0.15,
          },
          {
            label: "Batterie (+déch. / -charge, W)",
            data: batteryData,
            borderColor: "#9b8cff",
            backgroundColor: "rgba(155,89,182,0.24)",
            pointRadius: 0,
            borderDash: [4, 3],
            tension: 0.1,
          },
          {
            label: "Réseau (+achat / -vente, W)",
            data: gridData,
            borderColor: "#e0575b",
            backgroundColor: "rgba(224,87,91,0.24)",
            pointRadius: 0,
            tension: 0.1,
          },
          {
            label: "SoC batterie (%)",
            data: socData,
            borderColor: "#9a9ea8",
            backgroundColor: "transparent",
            borderDash:[2, 2],
            pointRadius: 0,
            tension: 0.1,
            yAxisID: "y1",
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "nearest", axis: "x", intersect: false },
        scales: {
          x: {
            type: "category", // Changement clé pour aligner les points à la suite
            title: { display: true, text: "Temps (Mois-Jour Heure)", color: "#9a9ea8" },
            ticks: { 
              color: "#9a9ea8",
              maxTicksLimit: 12 // Évite que les labels s'écrasent s'il y a 28 jours affichés
            },
            grid: { color: "#23272f" },
          },
          y: {
            title: { display: true, text: "Puissance (W)", color: "#9a9ea8" },
            ticks: { color: "#9a9ea8" },
            grid: { color: "#23272f" },
          },
          y1: {
            position: "right",
            min: 0,
            max: 100,
            title: { display: true, text: "SoC (%)", color: "#9a9ea8" },
            ticks: { color: "#9a9ea8" },
            grid: { display: false },
          },
        },
        plugins: {
          legend: { labels: { color: "#676b74", boxWidth: 12, font: { size: 10 } } },
        },
      },
    });
  }
  
  // On attend que le HTML soit totalement chargé par le navigateur
  document.addEventListener("DOMContentLoaded", init);
 
  return { init };
})();
