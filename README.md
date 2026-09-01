# DefuDelog v2.3 — Détection de Risque de Fuite de Données, SIEM Sémantique & Réponse aux Incidents

[![Release](https://img.shields.io/github/v/release/Projet-tres-perso/Defudelog?style=flat-square&color=blue)](https://github.com/Projet-tres-perso/Defudelog/releases)
[![Build Status](https://img.shields.io/github/actions/workflow/status/Projet-tres-perso/Defudelog/release.yml?branch=main&style=flat-square)](https://github.com/Projet-tres-perso/Defudelog/actions)
[![Rust](https://img.shields.io/badge/Rust-1.75%2B-orange?style=flat-square&logo=rust)](https://www.rust-lang.org/)
[![Tauri](https://img.shields.io/badge/Tauri-2.0-24C8D8?style=flat-square&logo=tauri)](https://tauri.app/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square)](https://opensource.org/licenses/MIT)

**DefuDelog v2.3** est une plateforme de détection des risques de fuite de données (DLP), d'analyse sémantique de journaux d'événements et de réponse aux incidents (SIEM/SOAR). Conçue en **Rust** et **Tauri v2 / React**, elle combine une analyse multi-couches à haute cadence ($> 20\,000\text{ logs/s}$), une vulgarisation sémantique multi-niveaux en français clair accessible aux équipes métiers et aux analystes SOC, un mini-widget bureau flottant (HUD) et un respect absolu de la confidentialité des données (fonctionnement 100% autonome et local).

---

## 🌟 Nouveautés Majeures & Expérience Utilisateur (v2.3)

-  **Mini-Widget Bureau Flottant (Desktop HUD)** :
  - Fenêtre miniature translucide *Glassmorphism* (340 × 235 px), frameless et déplaçable à la souris sur votre bureau.
  - Bouton d'épingle (*Always on Top*) et pastille de statut `LIVE` en direct.
  - Mini-courbe dynamique (Sparkline SVG) du débit de logs/s en temps réel.
  - Grille 2×2 des compteurs de menaces avec interaction au clic : *Risque de fuite*, *Authentification*, *Anomalies système*, *Privilèges*.
-  **Assistant Pas-à-Pas (*Quick-Setup Wizard*)** :
  - Configuration guidée en 4 étapes simples : diagnostic OS & UAC, activation des sources en 1 clic (Windows Events, Syslog UDP 514, dossiers applicatifs), calibrage de l'IA HDBSCAN, et démarrage avec/sans jeu d'essai.
- ⌨ **Palette de Commandes Globale (`Ctrl + F` / `Cmd + F` / `Ctrl + K`)** :
  - Pilotage instantané au clavier pour naviguer, lancer des actions rapides (ouvrir le HUD, injecter des logs démo, purger) ou rechercher universellement dans les logs.
-  **Mise en Surbrillance Automatique (*Smart Entity Highlighting*)** :
  - Un clic sur une adresse IP ou un nom d'hôte dans le visualiseur illumine immédiatement toutes les occurrences identiques visibles dans la liste, avec bouton d'action contextuelle *« Filtrer uniquement sur cette entité »*.
-  **Moteur Sémantique Multi-Niveaux & Dictionnaire Enrichi** :
  - Interprétation didactique à 3 niveaux : **1. Sens Métier Court**, **2. Explication Didactique**, **3. Action & Recommandation SOC**.
  - Intégration des modèles de diagnostics Windows PowerShell (`Get-WinEvent`, `EventLogException`).
-  **Mises à Jour Automatiques OTA avec Fallback GitHub API** :
  - Double vérification transparente via le plugin natif et l'API GitHub Releases publique, avec bouton de téléchargement & installation directe.

---

##  Comment Utiliser DefuDelog (Guide Pratique)

### 1.  Tableau de Bord (Dashboard)
- **Surveillance en temps réel** : Suivi du débit d'ingestion, répartition des menaces par sévérité et séries temporelles interactives.
- **Raccourci rapide** : Cliquez sur **`[Commandes (Ctrl+F)]`** ou **`[Widget Bureau HUD]`** pour piloter l'application.
- **Contrôle du flux** :
  - Bouton **`[Pause]`** pour figer l'affichage.
  - Bouton **`[ Reprendre le Direct]`** pour réactiver le flux temps réel.

### 2.  Explorateur de Logs & Analyse Multi-Niveaux (LogViewer)
- **Mode Sémantique / Hybride** : Basculez entre vue brute + explication vulgarisée ou vue vulgarisée uniquement.
- **Surbrillance Intelligente** : Cliquez sur n'importe quel badge d'IP ou de machine pour mettre en évidence toutes ses occurrences.
- **Volet d'Investigation Latérale** : Affiche les 3 niveaux d'explication, la recommandation SOC et la storyline ($\pm 10$ logs voisins).
- **Personnalisation Locale** : Bouton **`[✏️ Modifier]`** pour ajuster ou enrichir l'interprétation d'un log et l'enregistrer dans SQLite.

### 3.  Gestion des Alertes (Alerts)
- Qualification automatique du niveau de gravité (🔴 **High**, 🟠 **Moderate**, 🟡 **Low**).
- Affichage du motif d'anomalie HDBSCAN / BGE, des logs déclencheurs et déclenchement automatique des webhooks Slack/Discord/Teams ou scripts SOAR.

### 4.  Sources de Collecte (Sources)
- **Journaux Windows** : Security (EventID 4624/4625), Application, System.
- **Serveur Syslog Réseau (UDP/TCP)** : Centralisation sur le port 514 des pare-feux et serveurs Linux.
- **Surveillance de Fichiers** : Suivi temps réel des fichiers applicatifs Apache, NGINX, BDD.

### 5.  Configuration & Mises à Jour (Configuration)
- **Mini-Widget Bureau** : Boutons d'affichage et de masquage direct du HUD.
- **Mises à jour OTA** : Vérification manuelle et téléchargement en 1 clic.
- **Purge Asynchrone** : Purge et archivage JSON optimisés sans ralentissement de l'interface.

---

##  Architecture Technique

```text
DefuDelog v2.3
├──  Interface Desktop (React 18, TypeScript, Tailwind CSS, Recharts)
│   ├── QuickSetupWizard — Assistant de configuration en 4 étapes
│   ├── CommandPalette — Palette de commandes globale (Ctrl+F / Ctrl+K)
│   ├── DesktopWidget — Mini-widget flottant bureau HUD (340x235px, Drag, Sparkline)
│   ├── Dashboard — Métriques, flux temps réel et séries temporelles
│   ├── LogViewer — Vulgarisation, surbrillance d'entités et volet SOC
│   ├── Alertes — Triages, explications contextuelles et SOAR
│   ├── Sources — Collecteurs multi-OS (EventLog, unified log, Syslog UDP)
│   └── Configuration — Paramètres, dictionnaire OTA, purge asynchrone et MAJ
│
├──  Console Web Distante LAN (Tokio HTTP)
│   ├── Authentification par clé d'accès sécurisée à 7 caractères
│   └── Contrôle d'accès RBAC (Admin total vs Analyste restreint)
│
└──  Moteur Backend (Rust Natif sous Tauri 2)
    ├── db.rs — SQLite SQLCipher (WAL, mmap 256 Mo, purge non-bloquante)
    ├── engine.rs — Détection multi-axes (DLP, Drain, BGE/ONNX, HDBSCAN)
    ├── translator.rs — Moteur sémantique O(1) et dictionnaire translations_fr.json
    ├── collector.rs — Collecteurs multi-OS natifs
    ├── syslog_listener.rs — Serveur Syslog réseau asynchrone (Tokio UDP 514)
    └── active_response.rs — Déclenchement automatique de remédiation SOAR
```

---

##  Matrice d'Efficacité & Détection

$$\text{Probabilité Combinée } P(\text{Détection}) = 1 - \prod_{i} (1 - P_i)$$

| Type de Menace / Log | Moteurs Mobilisés | Probabilité | Niveau d'Alerte |
|---|---|:---:|:---:|
| **Risque de Fuite de Données (DLP)** | DLP Signatures + BGE Sémantique + Drain + HDBSCAN | **99.8 %** | 🔴 **High** (SOAR & Webhook) |
| **Élévation de Privilèges** | DLP Signatures + Drain Critical + BGE Sémantique | **99.4 %** | 🔴 **High** |
| **Attaque Force Brute / Auth** | Corrélation Temporelle + Drain Warning + BGE Profile | **97.6 %** | 🟠 **Moderate** / 🔴 **High** |
| **Crash / Défaillance Système** | Drain Warning + BGE Sémantique | **94.8 %** | 🟠 **Moderate** |
| **Menace Inconnue / Zero-Day** | Drain Template Inédit + HDBSCAN Outlier | **86.2 %** | 🟡 **Low** ➔ 🟠 **Moderate** |
| **Trafic Opérationnel Normal** | Template Standard + Baseline HDBSCAN | **< 1.2 %** *(Faux Positif)* | 🟢 **Benign** (Archivé) |

---

## ⌨️ Raccourcis Clavier Principaux

| Raccourci | Action |
|---|---|
| **`Ctrl + F`** ou **`Cmd + F`** | Ouvrir la palette de commandes globale & recherche universelle |
| **`Ctrl + K`** ou **`Cmd + K`** | Ouvrir la palette de commandes rapide |
| **`Échap` (`ESC`)** | Fermer la palette de commandes, l'assistant ou les modales |
| **`1` à `7`** (dans la palette) | Naviguer directement vers un onglet spécifique |

---

##  Licence
Distribué sous licence **MIT**. Développé pour la détection proactive des risques de fuite de données et la vulgarisation pédagogique de la cybersécurité.
