# DeFuDeLog v2.3 — Architecture Document

## 1. Vision & Objectifs

**DeFuDeLog v2.3** est une plateforme native de détection de fuites de données (Data Leak Prevention - DLP), de gestion des événements de sécurité (SIEM/SOAR), d'interprétation sémantique multi-niveaux et de surveillance réseau distribuée.

Elle résout les limitations historiques des systèmes à base de règles statiques grâce à :
- **Un Moteur Sémantique Multi-Niveaux & Rétroaction $O(1)$** : Décodage en 3 volets (*Sens Métier Immédiat*, *Explication Didactique Détaillée*, *Recommandation SOC*), variables nommées typées (`{user}`, `{ip}`, `{port}`...), tolérance floue Jaccard, persistance SQLite des surcharges utilisateur et mise à jour OTA sans recompilation.
- **L'analyse déterministe DLP** sans latence (mots-clés, regex pré-compilées, PII, secrets, règles SQLite).
- **Le Log Mining structural (Drain)** avec classification de templates et détection de Zero-Day.
- **La sémantique vectorielle dense (ONNX / BGE embeddings)** et similarité cosinus avec des profils de menaces.
- **Le clustering non supervisé (HDBSCAN)** sur fenêtre glissante.
- **La corrélation temporelle continue par décroissance exponentielle** ($e^{-\lambda t}$).
- **L'arbitrage contextuel par LLM (SOC Tier-2)** avec extraction chronologique des logs voisins ($\pm 10$ logs).
- **L'accès réseau distant sécurisé (Console Web LAN)** avec authentification par clé à 7 caractères et contrôle d'accès RBAC (Admin / Analyste).
- **Le streaming distribué d'entreprise via Apache Kafka** en ingestion et en publication des alertes enrichies.

---

## 2. Stack Technique Unifiée

| Couche | Technologie | Rôle & Justification |
|--------|-------------|----------------------|
| **Desktop Shell** | **Tauri 2.x** | Binaire natif ultra-léger (~15 Mo), zéro runtime Node en prod, sécurité par IPC isolée |
| **Backend Core** | **Rust (1.75+)** | Performance C-like, sûreté mémoire sans Garbage Collector, parallélisme via Tokio |
| **Console Web LAN** | **Tokio TcpListener (Rust natif)** | Serveur HTTP embarqué léger servant la console aux navigateurs du LAN sans serveur tiers |
| **Frontend UI** | **React 18 + TypeScript + Tailwind CSS** | Interface SOC moderne, rendu temps réel fluide, graphiques via `Recharts` |
| **Base de Données** | **SQLite + SQLCipher (AES-256)** | Chiffrement au repos, mode WAL haute concurrence, mmap 256 Mo |
| **Parser Structural** | **Drain-like Rust + LazyLock Regex** | O(1) extraction de constantes/variables, catalogue de templates critiques/warnings |
| **IA Sémantique** | **fastembed (ONNX Runtime / BGE-small)** | 384 dimensions denses, exécution locale C++ sans Python ni GPU |
| **Clustering Outlier** | **HDBSCAN (Rust)** | Regroupement non supervisé par densité adaptative, détection de bruit (-1) |
| **Streaming Entreprise** | **rdkafka / Apache Kafka (optionnel)** | Ingestion massive (Inbound) et transfert des alertes qualifiées (Outbound) |
| **Surveillance Réseau** | **Tokio UDP/TCP + pnet** | Serveur Syslog RFC 5424 (port 1514) + Sniffer NDR passif |
| **Interprétation IA** | **API LLM (OpenAI/Ollama/LocalAI/Claude)** | Triage contextuel automatisé SOC Tier-2 |

---

## 3. Schéma Global du Flux de Données

```text
                                 ┌─────────────────────────────────────────────────────────┐
                                 │                    INGESTION ENTRÉE                     │
                                 │  • FileWatcher (notify)   • Windows EventLog (wevtutil) │
                                 │  • Journald (journalctl)  • macOS log (log stream)      │
                                 │  • Syslog UDP/TCP (1514)  • Inbound Kafka Topic         │
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
                                                    ┌───────────────────────────┼───────────────────────────┐
                                                    ▼                           ▼                           ▼
                                        ┌───────────────────────┐   ┌───────────────────────┐   ┌───────────────────────┐
                                        │  EXPORT SIEM & WEBHOOK│   │  RÉPONSE ACTIVE SOAR  │   │ KAFKA OUTBOUND STREAM │
                                        │  • CEF / LEEF / RFC5424│  │  • Script remédiation │   │  • Alertes enrichies  │
                                        │  • Slack/Discord/Teams│   │  • Blocage IP / Host  │   │  • Format JSON ECS    │
                                        └───────────────────────┘   └───────────────────────┘   └───────────────────────┘
```

---

## 4. Architecture de la Console Web LAN & Modèle de Sécurité RBAC

Le composant `web_server.rs` implémente un serveur HTTP asynchrone autonome :
1. **Écoute Réseau** : Bind sur `0.0.0.0:[PORT]` (configurable, par défaut 8080).
2. **Authentification Sécurisée par Clé à 7 Caractères** :
   - Évite les mots de passe vulnérables ou complexes sur le LAN.
   - Générateur pseudo-aléatoire cryptographique basé sur un dictionnaire de 31 caractères non ambigus (`ABCDEFGHJKLMNPQRSTUVWXYZ23456789`).
3. **Contrôle d'Accès basé sur les Rôles (RBAC)** :
   - **Administrateur** : Authentifié par `(admin_username, admin_access_key)`. Accès total à tous les endpoints REST (`/api/stats`, `/api/logs`, `/api/alerts`, `/api/network`, `/api/rules`).
   - **Utilisateur / Analyste** : Authentifié par `(user_username, user_access_key)`. Les requêtes vers les endpoints REST non autorisés sont rejetées avec un code HTTP `403 Forbidden` basé sur `user_allowed_views`.

---

## 5. Intégration Apache Kafka Entreprise

```
[ Équipements Réseau / Serveurs ]
               │
               ▼ (Topic entrant: logs)
┌─────────────────────────────────────────────────────────────┐
│                      DeFuDeLog v2.1                         │
│  - Pipeline d'analyse multi-axes                            │
│  - Normalisation & vectorisation                            │
│  - Détection d'exfiltration DLP                             │
└─────────────────────────────┬───────────────────────────────┘
                              │ (Topic sortant: defudelog-alerts)
                              ▼
[ SIEM / SOC Central (Splunk, Elastic, Microsoft Sentinel) ]
```

---

## 6. Cycle de Vie et Désinstallation Propre (NSIS)

Sous Windows, le script `nsis_hooks.nsh` intervient lors du désabonnement de l'application :
- Invite interactive `MessageBox MB_YESNO` pour confirmer la suppression des données.
- Purge récursive de `%APPDATA%\defudelog` et `%LOCALAPPDATA%\defudelog` garantissant l'absence de traces résiduelles sur l'hôte.
