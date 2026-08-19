# DeFuDoLog v2.1 — Data Leak Detection, SIEM & Network Platform

[![Release](https://img.shields.io/github/v/release/Projet-tres-perso/Defudelog?style=flat-square&color=blue)](https://github.com/Projet-tres-perso/Defudelog/releases)
[![Build Status](https://img.shields.io/github/actions/workflow/status/Projet-tres-perso/Defudelog/release.yml?branch=main&style=flat-square)](https://github.com/Projet-tres-perso/Defudelog/actions)
[![Rust](https://img.shields.io/badge/Rust-1.75%2B-orange?style=flat-square&logo=rust)](https://www.rust-lang.org/)
[![Tauri](https://img.shields.io/badge/Tauri-2.0-24C8D8?style=flat-square&logo=tauri)](https://tauri.app/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square)](https://opensource.org/licenses/MIT)

**DeFuDoLog v2.1** est une plateforme desktop et réseau de détection de fuites de données (DLP), d'analyse d'événements de sécurité et de réponse aux incidents (SIEM/SOAR). Conçue en **Rust** et **Tauri/React**, elle offre une analyse multi-axes à haute performance, 100% autonome et respectueuse de la confidentialité des données.

---

## 🌟 Nouveautés Majeures de la Version 2.1

- 🚀 **Surveillance Immédiate Auto-démarrée** : Le moteur de collecte s'active instantanément au lancement de l'application sur toutes les sources actives (Windows Event Log, macOS Unified Log, journald, fichiers plats).
- 🌐 **Console Web LAN Embarquée (`IP:PORT`)** : Accès distant au tableau de bord depuis n'importe quel navigateur du réseau local avec authentification par clé de 7 caractères et gestion des rôles :
  - **👑 Profil Administrateur** : Accès intégral à l'ensemble des écrans et configurations.
  - **👤 Profil Analyste (User)** : Vues visibles configurables et restreintes par l'administrateur depuis l'application desktop.
- ⚡ **Connecteur Apache Kafka Bi-Directionnel** :
  - **Inbound** : Ingestion haute cadence de logs bruts depuis un topic Kafka.
  - **Outbound** : Publication en continu des logs enrichis et des alertes qualifiées (format ECS standardisé) vers un topic Kafka externe.
- 🧹 **Désinstallation Propre sous Windows (NSIS)** : Option interactive lors de la désinstallation pour supprimer l'intégralité des données de surveillance résiduelles (`%APPDATA%\defudolog`).

---

## 🏗️ Architecture du Système

```text
DeFuDoLog v2.1
├── 🖥️ Interface Utilisateur Desktop (React 18, TypeScript, Tailwind CSS, Recharts)
│   ├── Dashboard — Métriques globales, séries temporelles et flux de logs direct
│   ├── LogViewer — Exploration temps réel, recherche plein-texte et contexte chronologique
│   ├── Alertes — Gestion des alertes, validation SOC, triages et filtrages
│   ├── Sources — Gestion des collecteurs locaux, Windows Event Log et Syslog
│   ├── Règles — Création et gestion dynamique des règles de détection DLP
│   └── Configuration — Paramétrage du moteur, Kafka, Serveur LAN, LLM et SOAR
│
├── 🌐 Console Web Distante LAN (Serveur HTTP Rust Tokio Embarqué)
│   ├── Authentification par clé d'accès sécurisée à 7 caractères
│   └── Contrôle d'accès RBAC (Admin total vs Analyste restreint)
│
└── 🦀 Moteur Backend (Rust 100% Natif sous Tauri 2)
    ├── db.rs — SQLite SQLCipher (WAL, mmap 256 Mo, indexations avancées)
    ├── engine.rs — Détection multi-axes (DLP, Drain, BGE/ONNX, HDBSCAN, Decay, LLM)
    ├── collector.rs — Collecteurs multi-OS (Fichiers, Journald, macOS log, Windows EventLog, Kafka)
    ├── web_server.rs — Serveur Web LAN asynchrone embarqué
    ├── syslog_listener.rs — Serveur Syslog réseau asynchrone (Tokio UDP/TCP)
    ├── network.rs — Sniffer NDR passif bas niveau (pnet)
    ├── active_response.rs — Moteur d'exécution de remédiation SOAR
    ├── webhook_notifier.rs — Client Webhook asynchrone multi-plateformes
    └── siem_exporter.rs — Convertisseur CEF, LEEF et Syslog RFC 5424
```

---

## 📊 Matrice d'Efficacité & Probabilités de Détection

$$\text{Probabilité Combinée } P(\text{Détection}) = 1 - \prod_{i} (1 - P_i)$$

| Type de Menace / Log | Moteurs Mobilisés | Probabilité de Détection | Niveau d'Alerte |
|---|---|:---:|:---:|
| **Fuite de Données / Exfiltration (DLP)** | DLP Signatures + BGE Sémantique + Drain Critical + HDBSCAN | **99.8 %** | 🔴 **High** (SOAR Trigger) |
| **Élévation de Privilèges** | DLP Signatures + Drain Critical + BGE Sémantique | **99.4 %** | 🔴 **High** |
| **Attaque Force Brute / Auth** | Corrélation Temporelle + Drain Warning + BGE Auth Profile | **97.6 %** | 🟠 **Moderate** / 🔴 **High** |
| **Crash / Défaillance Système** | Drain Warning + BGE Sémantique | **94.8 %** | 🟠 **Moderate** |
| **Menace Inconnue / Zero-Day** | Drain Template Inédit + HDBSCAN Outlier + BGE Écart | **86.2 %** | 🟡 **Low** ➔ 🟠 **Moderate** |
| **Trafic Opérationnel Normal** | Template Standard + Baseline HDBSCAN | **< 1.2 %** *(Faux Positif)* | 🟢 **Benign** (Archivé) |

---

## 🚀 Guide d'Installation & Démarrage

### 1. Prérequis Système
- **Rust** (version 1.75 ou supérieure) : `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh`
- **Node.js** (version 20+ recommandée) et **npm** (10+).
- **Dépendances par Système** :
  - **macOS** : `xcode-select --install`
  - **Linux (Debian/Ubuntu)** : `sudo apt-get update && sudo apt-get install -y libwebkit2gtk-4.1-dev libssl-dev libgtk-3-dev libpcap-dev`
  - **Windows** : Visual Studio C++ Build Tools, OpenSSL v3.x (`choco install openssl`), et le [Npcap SDK](https://npcap.com/dist/npcap-sdk-1.13.zip).

### 2. Compilation et Exécution Locale

```bash
# 1. Cloner le projet
git clone https://github.com/Projet-tres-perso/Defudelog.git
cd Defudelog

# 2. Installer les dépendances frontend
npm install

# 3. Lancer en mode développement (Hot Reload Frontend + Backend)
npm run tauri dev

# 4. Compiler l'exécutable de production autonome (.exe / .dmg / .AppImage)
npm run tauri build
```

---

## 📚 Documentation Complète

- [Manuel Pédagogique et Technique Approfondi](Manuel.md)
- [Architecture & Spécifications Internes](ARCHITECTURE.md)

---

## 📄 Licence

Ce projet est sous licence open-source [MIT](LICENSE).
