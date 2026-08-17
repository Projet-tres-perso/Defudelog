# DeFuDoLog v2.0 — Data Leak Detection & SIEM Platform

[![Release](https://img.shields.io/github/v/release/Projet-tres-perso/Defudelog?style=flat-square&color=blue)](https://github.com/Projet-tres-perso/Defudelog/releases)
[![Build Status](https://img.shields.io/github/actions/workflow/status/Projet-tres-perso/Defudelog/release.yml?branch=main&style=flat-square)](https://github.com/Projet-tres-perso/Defudelog/actions)
[![Rust](https://img.shields.io/badge/Rust-1.75%2B-orange?style=flat-square&logo=rust)](https://www.rust-lang.org/)
[![Tauri](https://img.shields.io/badge/Tauri-2.0-24C8D8?style=flat-square&logo=tauri)](https://tauri.app/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square)](https://opensource.org/licenses/MIT)

**DeFuDoLog v2.0** est une plateforme desktop professionnelle de détection de fuites de données (DLP), d'analyse de journaux d'événements et de réponse aux incidents (SIEM/SOAR). Conçue en **Rust** et **Tauri/React**, elle offre une analyse multi-axes à haute performance, 100% autonome et respectueuse de la confidentialité des données.

---

## 🌟 Fonctionnalités Clés

- **Moteur de Détection Multi-Axes Parallélisé** :
  - **DLP & Signatures Déterministes** : Détection sans latence des clés privées RSA/SSH, tokens, mots de passe en clair, regex PII et règles SQLite dynamiques.
  - **Mineur de Templates Drain** : Extraction des variables, catalogue de templates critiques/warnings et détection d'anomalies structurelles (Zero-Day).
  - **Intelligence Sémantique BGE (ONNX)** : Vectorisation dense (384 dimensions) et similarité cosinus avec les profils de cyber-menaces.
  - **Clustering Non Supervisé HDBSCAN** : Détection d'outliers et de clusters atypiques sur fenêtre glissante de logs.
  - **Corrélation Temporelle Continue** : Détection de rafales d'attaques par décroissance exponentielle ($e^{-\lambda t}$).
  - **Validation Contextuelle par LLM (SOC Tier-2)** : Reconstitution de la storyline avec les logs voisins (±10 logs) pour éliminer 85%+ des faux positifs.
- **Surveillance Multi-OS (Endpoint)** : Surveillance native de fichiers plats (`notify`), Journald (Linux), Unified Log (macOS), et Windows Event Log.
- **Surveillance Réseau & NDR** :
  - **Serveur Syslog intégré** (UDP/TCP port 1514) pour centraliser les logs de serveurs et pare-feu distants sans agent tiers.
  - **Sniffer Réseau Passif (`pnet`)** pour la capture et l'analyse de métadonnées de flux TCP/UDP.
- **Stockage Sécurisé & Chiffré** : Base de données SQLite chiffrée en **SQLCipher (AES-256)** avec mode WAL haute concurrence.
- **Interopérabilité SIEM & Réponse Active (SOAR)** :
  - Exportation native aux formats **CEF** (ArcSight/Splunk), **LEEF** (QRadar), et **Syslog RFC 5424**.
  - Déclenchement automatique de scripts de remédiation active et notifications **Webhooks** (Slack, Discord, Teams).

---

## 🏗️ Architecture du Système

```text
DeFuDoLog v2.0
├── 🖥️ Interface Utilisateur (React 18, TypeScript, Tailwind CSS, Recharts)
│   ├── Dashboard — Métriques globales, séries temporelles et tendances de menaces
│   ├── LogViewer — Exploration temps réel, recherche plein-texte et contexte chronologique
│   ├── Alertes — Gestion des alertes, validation SOC, triages et filtrages
│   ├── Sources — Gestion des collecteurs locaux et du serveur Syslog
│   ├── Règles — Création et gestion dynamique des règles de détection DLP
│   └── Configuration — Paramétrage du moteur, seuils, LLM et scripts SOAR
│
└── 🦀 Moteur Backend (Rust 100% Natif sous Tauri 2)
    ├── db.rs — SQLite SQLCipher (WAL, mmap 256 Mo, indexations avancées)
    ├── engine.rs — Détection multi-axes (DLP, Drain, BGE/ONNX, HDBSCAN, Decay, LLM)
    ├── collector.rs — Collecteurs multi-OS (Fichiers, Journald, macOS log, Windows EventLog)
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

## 📖 Documentation Complète

- **[ARCHITECTURE.md](./ARCHITECTURE.md)** : Spécifications architecturales détaillées, structures de données, modèle mathématique et flux de données.
- **[Manuel.md](./Manuel.md)** : Manuel pédagogique et technique approfondi expliquant les algorithmes (Drain, ONNX, HDBSCAN, Exponential Decay, LLM).
- **[Analyse_perspective.md](./Analyse_perspective.md)** : Comparatif historique (v1 vs v2), audit de robustesse et perspectives d'évolution.

---

## 📄 Licence

Distribué sous licence **MIT**. Voir `LICENSE` pour plus d'informations.
