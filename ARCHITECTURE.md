# DeFuDoLog v2.0 — Architecture Document

## 1. Vision & Objectifs

**DeFuDoLog v2.0** est une plateforme desktop native de détection de fuites de données (Data Leak Prevention - DLP) et de gestion des événements de sécurité (SIEM/SOAR).

Elle résout les limitations historiques des systèmes à base de règles statiques grâce à un **moteur de détection multi-axes parallélisé** combinant :
- **L'analyse déterministe DLP** sans latence (mots-clés, regex pré-compilées, PII, secrets, règles SQLite).
- **Le Log Mining structural (Drain)** avec classification de templates et détection de Zero-Day.
- **La sémantique vectorielle dense (ONNX / BGE embeddings)** et similarité cosinus avec des profils de menaces.
- **Le clustering non supervisé (HDBSCAN)** sur fenêtre glissante.
- **La corrélation temporelle continue par décroissance exponentielle** ($e^{-\lambda t}$).
- **L'arbitrage contextuel par LLM (SOC Tier-2)** avec extraction chronologique des logs voisins (±10 logs).

---

## 2. Stack Technique Unifiée

| Couche | Technologie | Rôle & Justification |
|--------|-------------|----------------------|
| **Desktop Shell** | **Tauri 2.x** | Binaire natif ultra-léger (~15 Mo), zéro runtime Node en prod, sécurité par IPC isolée |
| **Backend Core** | **Rust (1.75+)** | Performance C-like, sûreté mémoire sans Garbage Collector, parallélisme via Tokio |
| **Frontend UI** | **React 18 + TypeScript + Tailwind CSS** | Interface SOC moderne, rendu temps réel fluide, graphiques via `Recharts` |
| **Base de Données** | **SQLite + SQLCipher (AES-256)** | Chiffrement au repos, mode WAL haute concurrence, mmap 256 Mo |
| **Parser Structural** | **Drain-like Rust + LazyLock Regex** | O(1) extraction de constantes/variables, catalogue de templates critiques/warnings |
| **IA Sémantique** | **fastembed (ONNX Runtime / BGE-small)** | 384 dimensions denses, exécution locale C++ sans Python ni GPU |
| **Clustering Outlier** | **HDBSCAN (Rust)** | Regroupement non supervisé par densité adaptative, détection de bruit (-1) |
| **Surveillance Réseau** | **Tokio UDP/TCP + pnet** | Serveur Syslog RFC 5424 (port 1514) + Sniffer NDR passif |
| **Interprétation IA** | **API LLM (OpenAI/Ollama/LocalAI/Claude)** | Triage contextuel automatisé SOC Tier-2 |

---

## 3. Schéma de l'Architecture Multi-Axes

```text
                                 ┌─────────────────────────────────────────────────────────┐
                                 │                    INGESTION ENTRÉE                     │
                                 │  • FileWatcher (notify)   • Windows EventLog (wevtutil) │
                                 │  • Journald (journalctl)  • macOS log (log stream)      │
                                 │  • Syslog UDP/TCP (1514)  • NDR Sniffer (pnet)          │
                                 └───────────────────────────┬─────────────────────────────┘
                                                             │ RawLog + SHA-256 Hash
                                                             ▼
                                 ┌─────────────────────────────────────────────────────────┐
                                 │                 BASE SQLite (SQLCipher)                 │
                                 │              Persistance immédiate (WAL)                │
                                 └───────────────────────────┬─────────────────────────────┘
                                                             │
                                ┌────────────────────────────┼─────────────────────────────┐
                                │                            │                             │
                                ▼                            ▼                             ▼
                    ┌───────────────────────┐   ┌───────────────────────────┐   ┌───────────────────────────┐
                    │      AXE DLP BRUT     │   │      AXE STRUCTURAL       │   │       AXE SÉMANTIQUE      │
                    │   (Direct Raw Log)    │   │        (Drain Parser)     │   │       (ONNX / BGE)        │
                    │ • Clés RSA/SSH        │   │ • Extraction constantes   │   │ • Embedding 384 dims      │
                    │ • Tokens & Secrets    │   │ • Template CriticalThreat │   │ • Similarité Cosinus avec │
                    │ • Regex PII & Pass    │   │ • Template WarningAnomaly │   │   profils cyber-menaces   │
                    │ • Règles SQLite Dyn   │   │ • Détection Zero-Day      │   │ • HDBSCAN Outlier (-1)    │
                    └───────────┬───────────┘   └─────────────┬─────────────┘   └─────────────┬─────────────┘
                                │                             │                               │
                                └───────────────────────┐     │     ┌─────────────────────────┘
                                                        │     │     │
                                                        ▼     ▼     ▼
                                            ┌───────────────────────────────┐
                                            │      AXE TEMPOREL (Decay)     │
                                            │  Score densité : e^(-λ * Δt)  │
                                            └───────────────┬───────────────┘
                                                            │
                                                            ▼
                                            ┌───────────────────────────────┐
                                            │   FUSION MULTI-AXES COMPOSITE │
                                            │  (Pondération 30/20/25/15/10) │
                                            └───────────────┬───────────────┘
                                                            │
                                        ┌───────────────────┴───────────────────┐
                                        ▼                                       ▼
                              Score < 0.25 (Bénin)                 Score ≥ 0.25 (Suspect / Alerte)
                              [Archivé sans bruit]                              │
                                                                                ▼
                                                                ┌───────────────────────────────┐
                                                                │   EXTRACTION DU CONTEXTE      │
                                                                │  (Logs voisins ±10 sur l'hôte)│
                                                                └───────────────┬───────────────┘
                                                                                │
                                                                                ▼
                                                                ┌───────────────────────────────┐
                                                                │  ARBITRAGE CONTEXTUEL LLM     │
                                                                │  (SOC Tier-2 Validation JSON) │
                                                                └───────────────┬───────────────┘
                                                                                │
                                                    ┌───────────────────────────┴───────────────────────────┐
                                                    ▼                                                       ▼
                                        ┌───────────────────────┐                               ┌───────────────────────┐
                                        │  EXPORT SIEM & WEBHOOK│                               │  RÉPONSE ACTIVE SOAR  │
                                        │  • CEF / LEEF / RFC5424│                              │  • Script remédiation │
                                        │  • Slack/Discord/Teams│                               │  • Blocage IP / Host  │
                                        └───────────────────────┘                               └───────────────────────┘
```

---

## 4. Modèle Mathématique de Détection & Formules

### 4.1 Corrélation Temporelle (Exponential Decay)
La densité d'événements pour une catégorie de motif $P$ au temps $t$ est calculée par :
$$S_{\text{decay}}(P, t) = \sum_{t_i \in \text{Events}(P), t - t_i \le 300} e^{-\lambda (t - t_i)}$$
avec $\lambda = 0.05$ (demi-vie temporelle d'environ 14 secondes).

### 4.2 Similarité Sémantique Cosinus
Soit $\vec{u}$ l'embedding BGE du log et $\vec{v}_{\text{menace}}$ le profil de référence (Exfiltration, Privilege Escalation, etc.) :
$$\text{Sim}(\vec{u}, \vec{v}) = \frac{\vec{u} \cdot \vec{v}}{\|\vec{u}\|_2 \|\vec{v}\|_2} = \frac{\sum_{i=1}^{384} u_i v_i}{\sqrt{\sum u_i^2} \sqrt{\sum v_i^2}}$$

### 4.3 Score de Risque Composite Final
$$\text{Score}_{\text{composite}} = 0.30 \cdot S_{\text{DLP}} + 0.20 \cdot S_{\text{Template}} + 0.25 \cdot S_{\text{Sémantique}} + 0.15 \cdot S_{\text{Temporel}} + 0.10 \cdot S_{\text{Outlier\_HDBSCAN}}$$

* **Règle d'Override Critique** : Si une signature DLP de criticité `High` ou un template `CriticalThreat` est validé, $\text{Score}_{\text{composite}} \ge 0.85$ immédiatement.

---

## 5. Schéma de la Base de Données (SQLite SQLCipher)

```sql
-- 1. Sources de logs surveillées
CREATE TABLE log_sources (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    source_type TEXT NOT NULL,
    hostname TEXT NOT NULL,
    os TEXT NOT NULL DEFAULT 'unknown',
    enabled INTEGER NOT NULL DEFAULT 1,
    config TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

-- 2. Logs bruts ingérés
CREATE TABLE raw_logs (
    id TEXT PRIMARY KEY,
    source_id TEXT NOT NULL,
    hostname TEXT NOT NULL,
    raw_message TEXT NOT NULL,
    log_hash TEXT NOT NULL,
    timestamp TEXT NOT NULL,
    ingested_at TEXT NOT NULL,
    FOREIGN KEY (source_id) REFERENCES log_sources(id)
);
CREATE INDEX idx_raw_logs_hash ON raw_logs(log_hash);
CREATE INDEX idx_raw_logs_timestamp ON raw_logs(timestamp);

-- 3. Logs structurés parsés par Drain
CREATE TABLE parsed_logs (
    id TEXT PRIMARY KEY,
    raw_log_id TEXT NOT NULL UNIQUE,
    raw_message TEXT NOT NULL,
    template TEXT NOT NULL,
    template_id INTEGER NOT NULL,
    parameters TEXT NOT NULL DEFAULT '[]',
    parsed_at TEXT NOT NULL,
    FOREIGN KEY (raw_log_id) REFERENCES raw_logs(id)
);

-- 4. Embeddings vectoriels BGE
CREATE TABLE log_embeddings (
    id TEXT PRIMARY KEY,
    parsed_log_id TEXT NOT NULL,
    raw_log_id TEXT NOT NULL,
    embedding BLOB NOT NULL,
    dimension INTEGER NOT NULL DEFAULT 384,
    created_at TEXT NOT NULL,
    FOREIGN KEY (raw_log_id) REFERENCES raw_logs(id)
);

-- 5. Alertes consolidées
CREATE TABLE alerts (
    id TEXT PRIMARY KEY,
    raw_log_id TEXT NOT NULL,
    parsed_log_id TEXT,
    template TEXT,
    category TEXT NOT NULL DEFAULT 'general',
    supervised_score REAL,
    anomaly_score REAL,
    cluster_id INTEGER,
    is_outlier INTEGER NOT NULL DEFAULT 0,
    final_score REAL NOT NULL,
    level TEXT NOT NULL DEFAULT 'low',
    reasons TEXT NOT NULL DEFAULT '[]',
    context_logs TEXT NOT NULL DEFAULT '[]',
    llm_explanation TEXT,
    mitigation_suggestion TEXT,
    detected_at TEXT NOT NULL,
    acknowledged INTEGER NOT NULL DEFAULT 0,
    acknowledged_at TEXT,
    FOREIGN KEY (raw_log_id) REFERENCES raw_logs(id)
);
CREATE INDEX idx_alerts_level ON alerts(level);
CREATE INDEX idx_alerts_time ON alerts(detected_at);

-- 6. Règles de détection dynamiques
CREATE TABLE detection_rules (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    rule_type TEXT NOT NULL,
    pattern TEXT NOT NULL,
    severity TEXT NOT NULL DEFAULT 'moderate',
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
);
```

---

## 6. Protocoles d'Exportation SIEM

DeFuDoLog implémente des formateurs natifs pour intégrer les alertes dans n'importe quel SIEM d'entreprise :

1. **CEF (Common Event Format - ArcSight, Splunk)** :
   `CEF:0|DeFuDoLog|Platform|2.0|DATA_LEAK|Fuite de données suspecte|9|rt=2026-08-15T12:00:00Z cat=data_leak score=0.92 msg=Clé privée RSA exposée`
2. **LEEF (Log Event Extended Format - IBM QRadar)** :
   `LEEF:2.0|DeFuDoLog|Platform|2.0|DATA_LEAK|	devTime=2026-08-15T12:00:00Z	cat=data_leak	sev=9	score=0.92	usrMsg=Clé privée RSA exposée`
3. **Syslog RFC 5424 (Standard IETF)** :
   `<11>1 2026-08-15T12:00:00Z localhost defudolog - data_leak [alert@defudolog level="high" score="0.92"] Clé privée RSA exposée`

---

## 7. Sécurité & Confidentialité des Données

- **Zéro fuite externe par défaut** : Tout le traitement (DLP, Drain, BGE, HDBSCAN, SQLite) tourne en mémoire locale sur la machine.
- **Base SQLCipher chiffrée** : Protection des données forensiques au repos contre l'extraction physique de disque.
- **Sandboxing IPC Tauri** : Aucune injection de script arbitraire n'est possible depuis la WebView.
- **LLM Local ou Dédié** : Support complet d'instances privées via Ollama, LM Studio ou LocalAI.
