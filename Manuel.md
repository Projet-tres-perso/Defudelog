# Manuel Pédagogique et Technique Approfondi — DeFuDoLog v2.1

Ce manuel s'adresse aux ingénieurs, analystes SOC, administrateurs et chercheurs en cybersécurité souhaitant maîtriser le fonctionnement, l'architecture logicielle, les capacités d'intégration réseau et le pipeline de détection de la plateforme **DeFuDoLog v2.1**.

---

## 1. Introduction : La Problématique des Fuites de Données (DLP)

Les fuites de données (*Data Exfiltration / Data Leakage*) constituent la menace la plus destructrice pour les organisations. Elles résultent de deux vecteurs majeurs :
1. **Attaques externes ciblées (APT)** : Compromission d'identifiants, élévation de privilèges, exfiltration discrète vers des buckets Cloud ou des serveurs C2.
2. **Menaces internes (*Insider Threats*)** : Employé malveillant, compte de service compromis, erreur de configuration ou vol de clés d'accès.

### Pourquoi les approches traditionnelles échouent-elles ?
* **L'approche par règles rigides (SIEM classique)** (*"Alerte si > 500 Mo transférés"*) est systématiquement contournée par l'exfiltration lente et fractionnée (*Low & Slow*).
* **L'approche par Machine Learning isolé en boîte noire** génère un taux de faux positifs intolérable et n'explique pas le contexte de l'incident à l'analyste SOC.
* **Les architectures séquentielles naïves** créent des goulots d'étranglement et perdent l'information si une seule étape de parsing échoue.

---

## 2. Architecture Globale du Pipeline Multi-Couche & Traduction Sémantique

```
                                      [ Log Brut Ingesté ]
                                               │
               ┌───────────────────────────────┴───────────────────────────────┐
               ▼                                                               ▼
[ Moteur de Traduction Sémantique O(1) ]                     [ Pipeline de Détection Multi-Axes ]
  • Dictionnaire Expert (Linux, Win, Web, Net)                 ├──> AXE 1 : DLP Déterministe (Regex O(1))
  • Extraction Drain & Interpolation Variables                 ├──> AXE 2 : Drain Structural & Zero-Day
  • Apprentissage Asynchrone via LLM                           ├──> AXE 3 : Sémantique BGE (FastEmbed)
  • "Sens Métier" en Français Clair (🟢 🔴 ⚠️ ℹ️)              ├──> AXE 4 : HDBSCAN Outlier Scoring
               │                                               └──> AXE 5 : Corrélation Temporelle
               ▼                                                               │
┌──────────────────────────────┐                                               ▼
│ MODES D'AFFICHAGE MODULABLES │                                    [ Fusion Score Composite ]
│ • 👁️ Vue Hybride (Brut + Sens)│                                               │
│ • 📖 Vue Vulgarisée (Sens seul)│                                              ▼
└──────────────────────────────┘                                     [ Arbitrage Contextuel SOC LLM ]
                                                                               │
                                                       ┌───────────────────────┴───────────────────────┐
                                                       ▼                                               ▼
                                            [ Kafka Outbound Stream ]                        [ Alertes SIEM & SOAR ]
```

### Justification des Choix Technologiques
1. **Traducteur Sémantique Déterministe ($O(1)$ à 0% CPU)** : Traduction instantanée des journaux techniques en phrases compréhensibles par tout collaborateur, par substitution des variables réelles (IP, Utilisateur, Port, Service) sans risque d'hallucination.
2. **HDBSCAN + Outlier Scoring** : Détection sans paramètre $\epsilon$ rigide, calcul de distance mutuelle de reachability et score GLOSH.
3. **FastEmbed & ONNX Runtime (Rust)** : Inférence vectorielle locale en **< 1.5 ms par log** (< 80 Mo de RAM, pas de runtime Python).
4. **Isolation par Source & Machine** : Traitement et filtrage individualisé de chaque entité (`PC1`, `Serveur-Web`) avec priorité paramétrable (Normale, Haute 🟠, Critique 🔴).
5. **Arbitrage Contextuel LLM (Tier-2)** : Analyse de la storyline chronologique ($\pm 10$ logs voisins) pour éliminer les faux positifs et générer des explications en langage naturel.

---

## 3. Collecte Temps Réel & Surveillance Multi-OS

### 3.1. Démarrage Automatique
Dès son lancement, DeFuDoLog démarre immédiatement la collecte sur toutes les sources configurées et actives. Aucune manipulation manuelle n'est requise.

### 3.2. Prise en Charge Windows (Event Log)
- **Canaux standards** : `Application`, `System` sont collectés nativement.
- **Canal de Sécurité (`Security`)** : Requiert une élévation Administrateur pour lire les événements d'audit (EventID 4624, 4672, 4720).
- **Élévation UAC en 1 clic** : Le bouton *"Relancer en Administrateur"* dans l'interface déclenche l'élévation UAC Windows sans interruption. Si le canal `Security` est interrogé sans élévation, un avertissement explicite est consigné dans le flux pour guider l'utilisateur.

### 3.3. macOS (Unified Log) & Linux (systemd-journald / Syslog)
- **macOS** : Collecte en flux continu via `log stream --style syslog` avec prédicats personnalisables.
- **Linux** : Streaming `journalctl --follow --output=short-iso` et suivi de fichiers (`/var/log/auth.log`, `/var/log/syslog`).

---

## 4. Intégration Apache Kafka (Inbound & Outbound Streaming)

DeFuDoLog s'intègre nativement dans une architecture d'entreprise via Apache Kafka pour le traitement haute cadence et la transmission aux SIEM centraux.

```
       ┌───────────────────────────────┐
       │   Sources Externes / Serveurs │
       │ (Syslog, Agents, Firewalls...)│
       └──────────────┬────────────────┘
                      │ (Publie les logs bruts)
                      ▼
        [ Topic Inbound : `logs` ]
                      │
                      ▼ (DeFuDoLog Consomme en temps réel)
┌─────────────────────────────────────────────────────────────┐
│                       DeFuDoLog                             │
│  1. Parsing Drain3 (Extraction de Template)                 │
│  2. Moteur IA Multi-Axes (DBSCAN + Isolation Forest + NLP)  │
│  3. Détection de Fuites & Exfiltration DLP                  │
│  4. Enrichissement LLM (Analyse cyber de l'incident)        │
└─────────────────────────────┬───────────────────────────────┘
                              │ (Publie les logs enrichis et les alertes)
                              ▼
     [ Topic Outbound : `defudolog-alerts` ]
                              │
                              ▼
       ┌───────────────────────────────┐
       │     SOC / SIEM / Dashboard    │
       │ (Splunk, Elastic, Sentinel)   │
       └───────────────────────────────┘
```

### 4.1. Flux Entrant (Consommateur de Logs)
1. DeFuDoLog se connecte aux courtiers (`brokers: ["192.168.1.100:9092"]`).
2. Il consomme en flux continu les logs non structurés provenant de vos serveurs et équipements réseau.
3. Chaque log est normalisé et injecté dans le pipeline d'IA multi-axes.

### 4.2. Flux Sortant (Producteur d'Alertes et Logs Enrichis)
1. Après traitement par les 5 moteurs d'analyse, DeFuDoLog publie sur le topic sortant :
   - Les **logs enrichis** (avec IDs de template, vecteurs sémantiques et indicateurs de conformité).
   - Les **alertes qualifiées** (format JSON ECS standardisé avec scores de fuite, classification MITRE ATT&CK, explications LLM et préconisations de remédiation).

### 4.3. Configuration dans l'Interface
Dans l'onglet **Paramètres > Connecteur Kafka** :
- Cliquez sur **"Activer le connecteur Kafka"**.
- Renseignez les adresses des brokers (ex: `localhost:9092, kafka-02:9092`).
- Définissez le topic d'entrée (ex: `logs-entreprises`) et le topic de sortie (ex: `defudolog-alerts`).

---

## 5. Console Web LAN Embarquée (Accès Réseau Distant `IP:PORT`)

DeFuDoLog intègre un serveur Web HTTP asynchrone ultra-léger (en Rust / Tokio) permettant d'accéder au tableau de bord depuis n'importe quel ordinateur ou smartphone connecté au réseau local (LAN/Wi-Fi).

### 5.1. Activation & Paramétrage
Dans l'onglet **Paramètres > Serveur Web LAN Embarqué** :
1. Activez l'interrupteur **"Accès Réseau Local"**.
2. Définissez le port d'écoute (par défaut : `8080`).
3. L'URL d'accès réseau s'affiche automatiquement : `http://[IP_LOCALE]:8080` (ex: `http://192.168.1.45:8080`).

### 5.2. Sécurité & Authentification à Deux Profils
L'accès à la console Web distante est protégé par une authentification par **Identifiant + Clé d'accès à 7 caractères** :

| Profil | Droits & Visibilité | Clé d'accès |
|---|---|:---:|
| **👑 Administrateur (Admin)** | **Accès intégral** : Tableau de bord, flux de logs, alertes DLP, règles de détection, découverte réseau et paramètres. | Clé 7 car. personnalisable ou régénérable (ex: `DF7K9QX`) |
| **👤 Utilisateur / Analyste (User)** | **Accès restreint** : Uniquement aux vues explicitement cochées depuis l'application desktop (Tableau de bord, Logs, Alertes, Réseau). | Clé 7 car. distincte (ex: `US4M2P8`) |

### 5.3. Fonctionnalités de la Console Web LAN
- Écran de connexion responsive avec champ de clé d'accès sécurisé à 7 caractères.
- Visualisation en direct des statistiques d'ingestion et du débit (EPS).
- Flux des logs et alertes qualifiées mis à jour en temps réel.
- Déconnexion et gestion sécurisée de session par jeton local.

---

## 6. Désinstallation Propre & Suppression des Fichiers Résiduels (Windows NSIS)

Lors de la désinstallation de DeFuDoLog sous Windows via le Panneau de configuration ou les Paramètres Windows :
1. Le programme de désinstallation NSIS s'exécute.
2. Une boîte de dialogue interactive demande confirmation :
   > *"Souhaitez-vous également supprimer définitivement toutes les données de surveillance résiduelles (base de données SQLite %APPDATA%\defudolog, logs ingérés et configurations de DeFuDoLog) ?"*
3. **Si vous cliquez sur "Oui"** : L'ensemble des répertoires `%APPDATA%\defudolog` et `%LOCALAPPDATA%\defudolog` sont purgés à 100%, ne laissant aucun fichier résiduel sur le système.

---

## 7. Matrice d'Efficacité & Probabilités de Détection

$$\text{Probabilité Combinée } P(\text{Détection}) = 1 - \prod_{i} (1 - P_i)$$

| Type de Menace / Log Suspect | Moteurs Déclencheurs Mobilisés | Probabilité de Détection | Niveau d'Alerte Résultant |
|---|---|:---:|:---:|
| **1. Fuite de Données / Exfiltration (DLP)**<br>*(dump SQL/CSV, upload S3, transfert cartes bancaires, fuite clé .pem)* | DLP Signatures + BGE Sémantique + Drain Critical + HDBSCAN | **99.8 %** | 🔴 **High** (SOAR, Kafka & Webhooks) |
| **2. Élévation de Privilèges**<br>*(chmod 777 /etc/shadow, sudoers, altération root)* | DLP Signatures + Drain Critical + BGE Sémantique | **99.4 %** | 🔴 **High** |
| **3. Attaque Force Brute / Authentification**<br>*(rafale sshd failed password, credential spraying PAM)* | Corrélation Temporelle + Drain Warning + BGE Auth Profile | **97.6 %** | 🟠 **Moderate** / 🔴 **High** |
| **4. Défaillance / Crash Système**<br>*(Out of Memory, kernel panic, segfault, HTTP 500)* | Drain Warning + BGE Sémantique + Signatures | **94.8 %** | 🟠 **Moderate** |
| **5. Menace Inconnue / Zero-Day (Sans mot-clé)**<br>*(commande exotique, comportement déviant inédit)* | Drain Template Inédit + HDBSCAN Outlier + BGE Écart Type | **86.2 %** | 🟡 **Low** ➔ 🟠 **Moderate** (après avis LLM) |
| **6. Trafic Opérationnel Normal (Bénin)**<br>*(requêtes HTTP 200 régulières, healthchecks applicatifs)* | Template Standard + Baseline HDBSCAN | **< 1.2 %** *(Faux Positif)* | 🟢 **Benign** (0 fausse alerte) |

---

## 8. Commandes et Raccourcis Utiles

| Action | Emplacement dans l'App | Description |
|---|---|---|
| **Démarrer / Arrêter la surveillance** | Dashboard (Haut Droit) | Contrôle global du collecteur |
| **Générer des logs de simulation** | Dashboard | Injecte des scénarios d'attaque DLP pour valider les règles |
| **Relancer en Administrateur** | Bandeau Supérieur (Windows/macOS/Linux) | Élévation UAC pour accès aux logs restreints |
| **Purger les données de démo** | Paramètres | Supprime toute trace de logs factices |
| **Tester le serveur LLM** | Paramètres > IA Locale | Vérifie la communication avec Ollama / LM Studio |
| **Tester le script SOAR** | Paramètres > Défense Active | Valide l'exécution du script de mitigation |
| **Activer la Console LAN** | Paramètres > Serveur LAN | Rend la console accessible à distance sur le réseau local |
| **Purger & Archiver les Logs** | Paramètres > Rétention & Purge | Purge des événements anciens avec archive JSON automatique |
| **Exporter vers SIEM (CEF/LEEF)** | Page Rapports | Téléchargement direct d'alertes normalisées pour SIEM & Excel |

---

## 9. Mises à Jour Automatiques OTA & Intégrité des Données

DeFuDoLog intègre un système officiel de mises à jour automatisées en direct (**Over-The-Air / OTA**) piloté par **Tauri Updater** et **GitHub Actions** :

1. **Zéro Perte de Données Garantie :**
   - Les données locales (base de données SQLite `defudolog.db`, règles personnalisées, sources configurées, dictionnaires sémantiques, clés d'API et journaux) sont stockées dans le dossier d'application sécurisé du système (`AppData` sous Windows, `Application Support` sous macOS, `~/.local/share` sous Linux).
   - Les mises à jour remplacent exclusivement le binaire exécutable sans jamais impacter la base de données.
   - Au redémarrage, les migrations SQLite s'exécutent automatiquement pour adapter le schéma si de nouveaux champs ont été créés.

2. **Expérience Utilisateur Transparente :**
   - Détection en tâche de fond de nouvelles versions publiées sur GitHub.
   - **Pastille / Notification lumineuse** dans l'application avec affichage du numéro de version et du changelog.
   - Bouton **« Mettre à jour maintenant »** avec barre de progression de téléchargement en direct et redémarrage en 1 clic.
   - Bouton de vérification manuelle disponible dans la page **Configuration**.

3. **Workflow CI/CD GitHub Actions (`.github/workflows/release.yml`) :**
   - Compilation automatisée pour macOS (Intel & Apple Silicon), Windows (x64) et Linux (x64).
   - Signature cryptographique Minisign des paquets et publication automatique du descripteur `latest.json`.
