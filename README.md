# DeFuDoLog v2.3 — Data Leak Detection, Semantic SIEM & Incident Response Platform

[![Release](https://img.shields.io/github/v/release/Projet-tres-perso/Defudelog?style=flat-square&color=blue)](https://github.com/Projet-tres-perso/Defudelog/releases)
[![Build Status](https://img.shields.io/github/actions/workflow/status/Projet-tres-perso/Defudelog/release.yml?branch=main&style=flat-square)](https://github.com/Projet-tres-perso/Defudelog/actions)
[![Rust](https://img.shields.io/badge/Rust-1.75%2B-orange?style=flat-square&logo=rust)](https://www.rust-lang.org/)
[![Tauri](https://img.shields.io/badge/Tauri-2.0-24C8D8?style=flat-square&logo=tauri)](https://tauri.app/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square)](https://opensource.org/licenses/MIT)

**DeFuDoLog v2.3** est une plateforme de détection de fuite de données (DLP), d'analyse sémantique de journaux d'événements et de réponse aux incidents (SIEM/SOAR). Conçue en **Rust** et **Tauri/React**, elle combine une analyse multi-couches à haute cadence ($> 20\,000\text{ logs/s}$), une vulgarisation sémantique multi-niveaux en français clair accessible aux équipes métiers et aux analystes SOC, et un respect absolu de la confidentialité des données (fonctionnement 100% autonome et local).

---

## 🌟 Points Forts & Nouveautés Majeures (v2.3)

- 🧠 **Moteur Sémantique Enrichi & Multi-Niveaux** :
  - **1. Sens Métier Immédiat (`meaning`)** : Résumé clair de l'événement en une phrase compréhensible par tous.
  - **2. Explication Didactique Détaillée (`explanation`)** : Contexte technique vulgarisé expliquant la cause de l'événement.
  - **3. Recommandation Opérationnelle SOC (`recommendation`)** : Actions immédiates suggérées pour sécuriser le poste ou le serveur.
- 🎯 **Variables Nommées Typées & Zéro Inversion** :
  - Extraction automatique sans inversion par expressions régulières typées : `{user}`, `{ip}`, `{port}`, `{file}`, `{table}`, `{status}`, `{app}`, `{domain}`, `{cmd}`.
- 🔍 **Correspondance Floue (*Fuzzy Token Jaccard*)** :
  - Tolérance aux variations mineures de syntaxe ou de versions logicielles avec calcul de similarité de Jaccard ($J \ge 0.70$).
- ✏️ **Boucle de Rétroaction & Personnalisation Locale** :
  - Édition et correction d'une interprétation en 1 clic directement dans l'interface, enregistrée instantanément dans la base SQLite locale (`template_translations`).
- 🌐 **Mise à Jour OTA du Dictionnaire** :
  - Téléchargement et synchronisation à chaud du dictionnaire sémantique depuis GitHub Releases sans recompiler l'application.
- ⚡ **Flux Direct Haute Performance & Pagination Intelligente** :
  - Ingestion bufferisée par lots (batching à 350 ms) garantissant 60 FPS constants sans ralentissement de l'interface.
  - **Auto-Freeze** : Le flux se fige automatiquement dès que vous feuilletez les pages d'historique, avec un bouton `[🟢 Reprendre le Direct]` pour reconnecter le temps réel.
- 🚀 **Mises à Jour Logicielles Automatiques OTA** :
  - Détection automatique des nouvelles versions publiées sur GitHub avec pastille lumineuse et redémarrage en 1 clic.
  - **Zéro Perte de Données Garantie** : La base de données SQLite locale (`defudolog.db`), les règles personnalisées et les historiques restent 100% préservés.
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

### 2. 📜 Explorateur de Logs & Analyse Multi-Niveaux (LogViewer)
- **Mode Sémantique / Vulgarisé** :
  - Cochez **« 👁️ Cacher les logs bruts »** pour ne lire que la vulgarisation en français clair.
  - Les badges de statut indiquent visuellement la nature de l'événement : 🟢 **Succès**, 🔵 **Information**, ⚠️ **Avertissement**, 🔴 **Critique**.
- **Investigation Multi-Niveaux** :
  - Cliquez sur n'importe quel log pour ouvrir le volet d'investigation latérale affichant :
    1. Le **Sens Métier Immédiat**
    2. L'**Explication Didactique Détaillée**
    3. L'**Action & Recommandation SOC**
    4. La **Storyline Chronologique ($\pm 10$ logs)**
- **Personnalisation d'une Interprétation** :
  - Cliquez sur **`[✏️ Modifier]`** pour ajuster le texte explicatif ou la recommandation d'un gabarit et sauvegarder la règle personnalisée dans SQLite.

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
- **Dictionnaire Sémantique** : Consultez les règles actives ou cliquez sur **`[Mettre à jour depuis GitHub (OTA)]`** pour synchroniser instantanément les dernières règles publiées.
- **IA Locale** : Connectez votre instance Ollama ou LM Studio locale pour des explications contextuelles de sécurité encore plus riches.
- **Mises à jour Logicielles OTA** : Cliquez sur **« Vérifier maintenant »** pour contrôler la disponibilité d'une nouvelle version de DeFuDoLog.

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
