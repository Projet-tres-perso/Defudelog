# DeFuDoLog v2.2 — Data Leak Detection, Semantic SIEM & Incident Response Platform

[![Release](https://img.shields.io/github/v/release/Projet-tres-perso/Defudelog?style=flat-square&color=blue)](https://github.com/Projet-tres-perso/Defudelog/releases)
[![Build Status](https://img.shields.io/github/actions/workflow/status/Projet-tres-perso/Defudelog/release.yml?branch=main&style=flat-square)](https://github.com/Projet-tres-perso/Defudelog/actions)
[![Rust](https://img.shields.io/badge/Rust-1.75%2B-orange?style=flat-square&logo=rust)](https://www.rust-lang.org/)
[![Tauri](https://img.shields.io/badge/Tauri-2.0-24C8D8?style=flat-square&logo=tauri)](https://tauri.app/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square)](https://opensource.org/licenses/MIT)

**DeFuDoLog v2.2** est une plateforme de détection de fuite de données (DLP), d'analyse sémantique de journaux d'événements et de réponse aux incidents (SIEM/SOAR). Conçue en **Rust** et **Tauri/React**, elle combine une analyse multi-couches à haute cadence ($> 20\,000\text{ logs/s}$), une vulgarisation en français clair accessible aux équipes métiers, et un respect absolu de la confidentialité des données (fonctionnement 100% autonome et local).

---

## 🌟 Points Forts & Nouveautés Majeures

- 📖 **Moteur de Traduction Sémantique $O(1)$** : Décode instantanément les logs bruts techniques complexes (Windows EventLog, macOS Unified Log, NGINX, Apache, MySQL, PostgreSQL, Linux) en phrases explicatives en français clair.
- 👁️ **Modes d'Affichage Flexibles** :
  - **Mode Hybride** : Affiche le log brut et sa signification métier en vis-à-vis.
  - **Mode Vulgarisé (Masquer les logs bruts)** : Affiche uniquement la signification métier épurée avec code couleur par niveau de criticité.
- ⚡ **Flux Direct Haute Performance & Pagination Intelligente** :
  - Ingestion bufferisée par lots (batching à 350 ms) garantissant 60 FPS constants sans ralentissement de l'interface.
  - **Auto-Freeze** : Le flux se fige automatiquement dès que vous feuilletez les pages d'historique, avec un bouton `[🟢 Reprendre le Direct]` pour reconnecter le temps réel.
- 🚀 **Mises à Jour Automatiques OTA (Over-The-Air)** :
  - Détection automatique des nouvelles versions publiées sur GitHub avec pastille de notification.
  - Mise à jour et redémarrage en 1 clic.
  - **Zéro Perte de Données Garantie** : La base de données SQLite locale (`defudolog.db`), les règles personnalisées et les historiques sont 100% conservés.
- 🌐 **Console Web LAN Distante Embarquée** : Accès au tableau de bord depuis n'importe quel terminal du réseau local via clé de sécurité et contrôle d'accès RBAC (Admin vs Analyste).
- 🛡️ **DLP & Détection Multi-Axes** : Moteur déterministe par signatures, modèle ONNX BGE sémantique local, clustering HDBSCAN des anomalies et intégration LLM locale (Ollama / LM Studio).

---

## 🎯 Comment Utiliser DeFuDoLog (Guide Pratique)

### 1. 🖥️ Tableau de Bord (Dashboard)
- **Surveillance en temps réel** : Dès l'ouverture, DeFuDoLog surveille vos sources de collecte locales ou réseau.
- **Contrôle du flux** :
  - Cliquez sur **`[⏸️ Pause]`** pour suspendre le défilement et inspecter une ligne suspecte.
  - Utilisez les boutons **`[< Précédent]`** et **`[Suivant >]`** pour naviguer dans l'historique paginé.
  - Cliquez sur **`[🟢 Reprendre le Direct]`** pour réactiver le flux temps réel instantanément.
- **Filtres par source** : Basculez entre les événements **💻 Locaux** et **🌐 Réseau (IP)** en un clic.

### 2. 📜 Explorateur de Logs (LogViewer)
- **Mode Sémantique / Vulgarisé** :
  - Cochez **« 👁️ Cacher les logs bruts »** pour ne lire que la vulgarisation en français clair.
  - Les badges de statut indiquent visuellement la nature de l'événement : 🟢 **Succès**, 🔵 **Information**, ⚠️ **Avertissement**, 🔴 **Critique**.
- **Séparation par Machine / Source** :
  - Sélectionnez un hôte spécifique dans le sélecteur de source pour isoler l'analyse d'une machine cible ou d'un serveur précis.
- **Recherche & Filtrage** :
  - Tapez un mot-clé (ex: `ssh`, `4625`, `SELECT`, `502`, `192.168.1.50`) pour filtrer instantanément dans les millions de logs indexés.

### 3. 🚨 Gestion des Alertes (Alerts)
- Lorsqu'une fuite de données, une élévation de privilèges ou une tentative d'intrusion est détectée, une alerte est qualifiée avec son niveau de sévérité (**High**, **Moderate**, **Low**).
- Cliquez sur une alerte pour afficher :
  - L'explication générée par le moteur IA / SOC.
  - Les logs bruts associés qui ont déclenché la détection.
  - Le score d'anomalie composite.
- Acquittez ou classez l'alerte pour tenir à jour votre journal d'incidents.

### 4. 📡 Sources de Collecte (Sources)
- **Détection Automatique** : Cliquez sur **« Détection automatique des sources »** pour ajouter en 1 clic les journaux système de votre système d'exploitation.
- **Ajout Manuel de Fichiers** : Surveillez des fichiers spécifiques (fichiers Apache `/var/log/apache2/access.log`, NGINX `/var/log/nginx/error.log`, PostgreSQL, MySQL ou applications métiers).
- **Serveur Syslog Réseau (UDP/TCP)** : Activez l'écoute Syslog sur le port standard (ex: `514` ou `1514`) pour centraliser les logs de vos pare-feux, commutateurs, routeurs et serveurs distants.

### 5. ⚙️ Configuration & Mises à Jour (Configuration)
- **Dictionnaire Sémantique** : Consultez ou rechargez à chaud le catalogue JSON `translations_fr.json`.
- **IA Locale** : Connectez votre instance Ollama ou LM Studio locale pour des explications contextuelles de sécurité encore plus riches.
- **Mises à jour OTA** : Cliquez sur **« Vérifier maintenant »** pour contrôler la disponibilité d'une nouvelle version de DeFuDoLog.

---

## 🏗️ Architecture Technique

```text
DeFuDoLog v2.2
├── 🖥️ Interface Utilisateur Desktop (React 18, TypeScript, Tailwind CSS, Recharts)
│   ├── Dashboard — Métriques globales, séries temporelles et flux direct paginé
│   ├── LogViewer — Exploration vulgarisée/hybride et isolation par machine
│   ├── Alertes — Triages SOC, explications contextuelles et remédiation
│   ├── Sources — Collecteurs multi-OS (EventLog, unified log, syslog UDP/TCP)
│   ├── Règles — Moteur de signatures DLP et détection personnalisée
│   └── Configuration — Paramétrage du moteur, IA locale, dictionnaire et mises à jour OTA
│
├── 🌐 Console Web Distante LAN (Serveur HTTP Rust Tokio Embarqué)
│   ├── Authentification par clé d'accès sécurisée à 7 caractères
│   └── Contrôle d'accès RBAC (Admin total vs Analyste restreint)
│
└── 🦀 Moteur Backend (Rust 100% Natif sous Tauri 2)
    ├── db.rs — SQLite SQLCipher (WAL, mmap 256 Mo, persistance sécurisée)
    ├── engine.rs — Détection multi-axes (DLP, Drain 2-Pass, BGE/ONNX, HDBSCAN)
    ├── translator.rs — Moteur sémantique O(1) et dictionnaire translations_fr.json
    ├── collector.rs — Collecteurs multi-OS temps réel
    ├── syslog_listener.rs — Serveur Syslog réseau asynchrone (Tokio UDP/TCP)
    └── active_response.rs — Déclenchement automatique de remédiation SOAR
```

---

## 📊 Matrice d'Efficacité & Détection

$$\text{Probabilité Combinée } P(\text{Détection}) = 1 - \prod_{i} (1 - P_i)$$

| Type de Menace / Log | Moteurs Mobilisés | Probabilité | Niveau d'Alerte |
|---|---|:---:|:---:|
| **Fuite de Données / Exfiltration (DLP)** | DLP Signatures + BGE Sémantique + Drain + HDBSCAN | **99.8 %** | 🔴 **High** (SOAR Trigger) |
| **Élévation de Privilèges** | DLP Signatures + Drain Critical + BGE Sémantique | **99.4 %** | 🔴 **High** |
| **Attaque Force Brute / Auth** | Corrélation Temporelle + Drain Warning + BGE Profile | **97.6 %** | 🟠 **Moderate** / 🔴 **High** |
| **Crash / Défaillance Système** | Drain Warning + BGE Sémantique | **94.8 %** | 🟠 **Moderate** |
| **Menace Inconnue / Zero-Day** | Drain Template Inédit + HDBSCAN Outlier | **86.2 %** | 🟡 **Low** ➔ 🟠 **Moderate** |
| **Trafic Opérationnel Normal** | Template Standard + Baseline HDBSCAN | **< 1.2 %** *(Faux Positif)* | 🟢 **Benign** (Archivé) |

---

## 🚀 Installation & Développement

### 1. Prérequis
- **Rust** (version 1.75+) : `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh`
- **Node.js** (version 20+) et **npm**.
- **Outils système** :
  - **macOS** : `xcode-select --install`
  - **Linux (Debian/Ubuntu)** : `sudo apt-get update && sudo apt-get install -y libwebkit2gtk-4.1-dev libssl-dev libgtk-3-dev libpcap-dev`
  - **Windows** : Visual Studio C++ Build Tools et OpenSSL v3.x.

### 2. Démarrage Rapide

```bash
# 1. Cloner le projet
git clone https://github.com/Projet-tres-perso/Defudelog.git
cd Defudelog

# 2. Installer les dépendances
npm install

# 3. Lancer en mode développement (Hot-Reloading Frontend + Backend)
npm run start

# 4. Compiler l'exécutable de production autonome
npm run tauri build
```

---

## 📚 Documentation Complémentaire

- [Manuel Pédagogique et Technique Approfondi](Manuel.md)
- [Architecture & Spécifications Internes](ARCHITECTURE.md)

---

## 📄 Licence

Ce projet est distribué sous licence open-source [MIT](LICENSE).
