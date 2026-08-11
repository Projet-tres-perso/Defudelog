# DeFuDoLog v2 — Architecture Document

## 1. Vision

DeFuDoLog v2 est une **plateforme desktop cross-platform** de détection de fuite de données par analyse de logs. Elle succède au POC Python/Kafka v1 en apportant : moteur embarqué Rust, base SQLite, interface Tauri/React, collecte multi-OS native et configuration unifiée.

## 2. Stack technique

| Couche | Technologie | Justification |
|--------|-------------|---------------|
| Desktop shell | **Tauri 2.x** | Binaire natif ~5 Mo, accès système complet, cross-platform |
| Backend | **Rust** | Performance, sécurité mémoire, parallélisme natif |
| Frontend | **React 18 + TypeScript** | Écosystème mature, typage fort |
| Base de données | **SQLite (rusqlite)** | Embarquée, zéro config, ACID, WAL |
| Parsing logs | **Drain-like (Rust)** | Algorithme éprouvé, O(n), porté de Python |
| ML/Statistique | **smartcore / linfa** | ML en Rust pur, pas de dépendance Python |
| Kafka | **rdkafka** (optionnel) | Feature-gated, bridge entrée/sortie |
| LLM | Appels HTTP locaux | LM Studio / Ollama compatibles |

## 3. Architecture logicielle

```
┌──────────────────────────────────────────────────────────────────┐
│                    Tauri Process                                  │
│  ┌─────────────────────┐     ┌─────────────────────────────────┐ │
│  │   WebView (React)   │     │        Rust Backend             │ │
│  │                     │     │                                 │ │
│  │ • Dashboard         │◄───►│ • commands.rs (Tauri API)       │ │
│  │ • LogViewer         │ IPC │ • engine.rs (Detection Engine)  │ │
│  │ • Alerts            │     │ • collector.rs (Log Collectors) │ │
│  │ • Sources           │     │ • db.rs (SQLite Layer)         │ │
│  │ • Configuration     │     │ • models.rs (Domain Types)     │ │
│  │ • Reports           │     │ • error.rs (Error Handling)    │ │
│  └─────────────────────┘     └──────────────┬──────────────────┘ │
│                                              │                    │
│                               ┌──────────────┴──────────────┐    │
│                               │       SQLite Database        │    │
│                               │  • raw_logs                  │    │
│                               │  • parsed_logs               │    │
│                               │  • embeddings                │    │
│                               │  • clusters                  │    │
│                               │  • alerts                    │    │
│                               │  • detection_rules           │    │
│                               │  • log_sources               │    │
│                               │  • settings                  │    │
│                               └──────────────────────────────┘    │
└──────────────────────────────────────────────────────────────────┘
```

## 4. Pipeline de détection

```
Source Logs ──► Collector ──► RawLog ──► Parser (Drain-like) ──► Template
                 (multi-OS)     │                                    │
                                │                                    ▼
                                │                           Embedding (TF-IDF)
                                │                                    │
                                │                    ┌───────────────┼───────────────┐
                                │                    ▼               ▼               ▼
                                │            Supervised RF    DBSCAN         Isolation Forest
                                │                    │               │               │
                                │                    └───────────────┼───────────────┘
                                │                                    ▼
                                │                           Score Fusion
                                │                           (moy. pondérée)
                                │                                    │
                                │                                    ▼
                                └──────────────────────────► Alert + Rapport LLM
```

### 4.1 Parsing (Drain-like)

Algorithme inspiré de Drain3, implémenté en Rust pur :
- Tokenisation avec regex prédéfinis (IP, UUID, dates, nombres, chemins)
- Recherche du template le plus proche par similarité de tokens
- Création automatique de nouveaux templates si nécessaire
- Cache LRU des templates pour limiter la mémoire

### 4.2 Classification supervisée

- Vectorisation TF-IDF des templates (n-grams 1-2)
- Random Forest (100 estimateurs) entraîné sur données étiquetées
- Seuil ajustable (défaut : 0.6)
- Réentraînement périodique configurable

### 4.3 Clustering DBSCAN

- Appliqué sur les embeddings TF-IDF
- Paramètres `eps` et `min_samples` configurables
- Les outliers (cluster_id = -1) sont marqués comme suspects
- HDBSCAN envisageable pour évolution future

### 4.4 Détection d'anomalies (Isolation Forest)

- Fenêtre glissante de N logs (par défaut 500)
- Isolation Forest entraîné sur embeddings du cluster
- Scores normalisés 0-1
- Seuil d'anomalie configurable (défaut : 0.3)

### 4.5 Fusion des scores

$$
\text{final\_score} = \alpha \cdot \text{supervised\_score} + (1-\alpha) \cdot \text{anomaly\_score}
$$

Avec par défaut $$ \alpha = 0.5 $$.

Règles de décision :
```
IF supervised_label = suspect AND is_outlier AND anomaly_score > threshold
  → alerte_forte
ELSE IF is_outlier AND anomaly_score > threshold
  → alerte_suspect
ELSE IF supervised_label = suspect OR is_outlier
  → alerte_moderee
ELSE
  → benign
```

## 5. Base de données (SQLite)

### 5.1 Tables principales

```sql
raw_logs (id, source_id, hostname, raw_message, log_hash, timestamp, ingested_at)
parsed_logs (id, raw_log_id, raw_message, template, template_id, parameters, parsed_at)
embeddings (id, parsed_log_id, raw_log_id, embedding, dimension, created_at)
clusters (id, embedding_id, raw_log_id, cluster_id, is_outlier, labeled_at)
alerts (id, raw_log_id, parsed_log_id, template, supervised_score, anomaly_score,
        cluster_id, is_outlier, final_score, level, reasons, context_logs,
        detected_at, acknowledged, acknowledged_at)
detection_rules (id, name, description, rule_type, pattern, severity, enabled, created_at)
log_sources (id, name, source_type, hostname, os, enabled, config, created_at, updated_at)
settings (key, value, updated_at)
```

### 5.2 Optimisations

- Mode WAL pour lectures concurrentes
- mmap activé (256 Mo)
- Index sur `log_hash`, `timestamp`, `level`, `cluster_id`
- Cache size 64 Mo
- Foreign keys activées pour l'intégrité référentielle

## 6. Collecteurs multi-OS

| OS | Source | Méthode | Dépendance |
|----|--------|---------|------------|
| Linux | systemd-journald | `journalctl` ou libsystemd | systemd |
| Linux | Fichiers | notify (inotify) | kernel |
| macOS | Unified Log | `log stream` command | macOS 10.12+ |
| macOS | Fichiers | notify (FSEvents) | kernel |
| Windows | Event Log | Win32 Event Log API | Windows API |
| Windows | Fichiers | notify (ReadDirectoryChangesW) | kernel |
| Tous | Fichiers texte | File watcher générique | crate `notify` |
| Tous | Kafka | rdkafka consumer | Feature `kafka` |

## 7. Interface utilisateur

### 7.1 Pages

| Page | Fonctionnalité |
|------|----------------|
| **Dashboard** | Statistiques globales, tendances, répartition alertes |
| **Logs** | Recherche, filtrage, pagination, vue détaillée avec template |
| **Alertes** | Liste avec niveau, scores, filtrage, acquittement |
| **Sources** | Gestion des sources (ajout, activation, arrêt) |
| **Rapports** | Génération LLM, export JSON |
| **Configuration** | Paramètres détection, Kafka, LLM, règles |

### 7.2 Design System

- Thème sombre (surface-950 à surface-50)
- Couleurs fonctionnelles : rouge (haute), ambre (modérée), bleu (basse), émeraude (benign)
- Typographie : Inter (UI) + JetBrains Mono (logs)
- Composants : cards, badges, boutons, inputs avec états focus/hover/disabled
- Animations subtiles, respect de prefers-reduced-motion

## 8. Intégration Kafka (optionnelle)

Feature-gated derrière `#[cfg(feature = "kafka")]` :
- Lecture depuis un topic Kafka en complément des sources locales
- Écriture des alertes vers un topic Kafka
- Configuration SASL/SSL supportée

## 9. Sécurité

- Base de données locale uniquement (pas d'exposition réseau)
- Interface Tauri avec isolation WebView
- Kafka : authentification SASL/SSL (si activé)
- LLM : connexion locale uniquement (LM Studio / Ollama)
- Pas de collecte de données externes

## 10. Workflow utilisateur

1. **Installation** : Téléchargement du binaire (macOS .dmg, Linux .AppImage, Windows .msi)
2. **Configuration des sources** : Ajout via l'interface (fichier, journald, etc.)
3. **Démarrage de la collecte** : Activation des sources
4. **Visualisation** : Dashboard temps réel, exploration des logs
5. **Détection** : Automatique à chaque batch, paramétrable
6. **Investigation** : Consultation des alertes, contexte, scores
7. **Rapport LLM** : Analyse contextuelle par IA locale (optionnel)
8. **Export** : Alertes en JSON, base de données portable

## 11. Évolutions futures

- [ ] HDBSCAN pour clustering adaptatif
- [ ] Modèle BERT/E5 embarqué pour embeddings sémantiques
- [ ] Streaming Isolation Forest (sans batch)
- [ ] Plugins de collecteurs (API d'extension)
- [ ] Alertes par email/webhook
- [ ] Chiffrement de la base de données (SQLCipher)
- [ ] Multi-tenant (plusieurs projets/configurations)
- [ ] Export SIEM (CEF, LEEF, Syslog)
