# DeFuDoLog v2 — Data Leak Detection Platform

Plateforme desktop de détection de fuite de données par analyse multi-couche de logs.

**Version 2.0** — Refonte complète en Tauri (Rust + React).

## Architecture

```
DeFuDoLog v2
├── Frontend React (TypeScript, Tailwind CSS, Recharts)
│   ├── Dashboard — Statistiques et tendances en temps réel
│   ├── LogViewer — Exploration et recherche de logs
│   ├── Alerts — Gestion des alertes avec filtres et actions
│   ├── Sources — Configuration des sources multi-OS
│   ├── Reports — Rapports LLM contextuels
│   └── Configuration — Paramétrage complet du moteur
│
├── Backend Rust (Tauri)
│   ├── DB Layer — SQLite optimisé (WAL, mmap, 12 tables)
│   ├── Collector — Collecte multi-OS (FileWatcher, Journald, macOS Log, Windows EventLog)
│   ├── Engine — Drain-like parser, TF-IDF + RandomForest, DBSCAN, Isolation Forest
│   ├── Commands — API Tauri pour le frontend
│   └── Kafka Bridge — Intégration optionnelle via rdkafka
```

## Prérequis

- **Rust** 1.75+
- **Node.js** 20+
- **npm** 10+
- **Tauri CLI** (`cargo install tauri-cli --version "^2.0"`)
- **macOS** : Xcode Command Line Tools
- **Linux** : `libwebkit2gtk-4.1-dev`, `libgtk-3-dev`, `libappindicator3-dev`
- **Windows** : Visual Studio Build Tools, WebView2

## Installation

```bash
cd defudolog-app
npm install
cargo install tauri-cli
npm run tauri dev    # Mode développement
npm run tauri build  # Build production
```

## Stack technique

| Couche | Technologie |
|--------|-------------|
| Desktop Shell | Tauri 2.0 |
| Backend | Rust 2021 |
| Frontend | React 18 + TypeScript + Tailwind CSS |
| Base de données | SQLite (via rusqlite, mode WAL) |
| ML | SmartCore / Linfa (RandomForest, DBSCAN, IsolationForest) |
| Parsing | Drain-like template miner (Rust natif) |
| Collecte | notify (file watcher), rdev (journald), API natives OS |
| Visualisation | Recharts |
| Kafka (optionnel) | rdkafka |

## Schéma SQLite (12 tables)

- `log_sources` — Sources de logs configurées
- `raw_logs` — Logs bruts ingérés (indexés par hash + timestamp)
- `parsed_logs` — Templates et paramètres extraits
- `log_embeddings` — Vecteurs d'embedding pour chaque log
- `cluster_results` — Assignations de clusters DBSCAN
- `alerts` — Alertes de détection avec scores
- `detection_rules` — Règles configurables
- `supervised_model` — Modèle supervisé sérialisé
- `template_stats` — Statistiques de fréquence des templates
- `app_settings` — Configuration persistante
- `kafka_config` — Configuration Kafka optionnelle
- `llm_analyses` — Rapports LLM générés

## Moteur de détection

### Pipeline de traitement
1. **Ingestion** → Log brut
2. **Parsing** → Drain-like → Template + Paramètres
3. **Embedding** → TF-IDF sur templates → Vecteur numérique
4. **Clustering** → DBSCAN → Regroupement + outliers
5. **Supervisé** → RandomForest → Score suspect/bénin
6. **Anomalie** → Isolation Forest → Score d'anomalie
7. **Fusion** → Score pondéré + Règles → Niveau d'alerte

### Scores
- `final_score = 0.4 * supervised_score + 0.4 * anomaly_score + 0.2 * outlier_bonus`
- **Alerte forte** : suspect + outlier + anomalie
- **Alerte modérée** : 2 critères sur 3
- **Alerte faible** : 1 critère sur 3
- **Bénin** : aucun critère

## Collecteurs multi-OS

| OS | Collecteur | Source |
|----|-----------|--------|
| Linux | Journald | `journalctl` bindings |
| macOS | Unified Log | `log show` via process |
| Windows | Event Log | Windows Event Log API |
| Tous | File Watcher | `notify` crate (inotify/FSEvents/ReadDirectoryChanges) |
| Optionnel | Kafka | `rdkafka` |

## Améliorations vs v1 (Python/Kafka)

| Problème v1 | Solution v2 |
|------------|-------------|
| Configuration hardcodée | SQLite + UI de paramétrage |
| Pas de logging | `env_logger` structuré |
| Cache sans TTL | SQLite avec index + cleanup périodique |
| Duplication de code | Architecture modulaire Rust |
| Batch 100 points IF | Batch configurable (défaut 500) |
| Bug main_3.py | Moteur Rust typé et testable |
| Interface polling jQuery | React + Tauri commands |
| Pas de tests | Structure prête pour `cargo test` |
| Pas de monitoring | Dashboard temps réel |

## Licence

MIT
