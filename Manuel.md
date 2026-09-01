# Manuel Pédagogique et Technique Approfondi — DefuDelog v2.3

Ce manuel s'adresse aux ingénieurs, analystes SOC, administrateurs et chercheurs en cybersécurité souhaitant maîtriser le fonctionnement, l'architecture logicielle, les capacités d'intégration réseau, le moteur sémantique multi-niveaux, le mini-widget bureau HUD, et le pipeline de détection de la plateforme **DefuDelog v2.3**.

---

## 1. Introduction : Risques de Fuite de Données (DLP) & Compréhension Sémantique

Les risques de fuite de données (*Data Exfiltration / Data Leakage*) constituent la menace la plus destructrice pour les organisations. Ils résultent de deux vecteurs majeurs :
1. **Attaques externes ciblées (APT)** : Compromission d'identifiants, élévation de privilèges, exfiltration discrète vers des buckets Cloud ou des serveurs C2.
2. **Menaces internes (*Insider Threats*)** : Employé malveillant, compte de service compromis, erreur de configuration ou vol de clés d'accès.

### Pourquoi les approches traditionnelles échouent-elles ?
* **L'approche par règles rigides (SIEM classique)** (*"Alerte si > 500 Mo transférés"*) est systématiquement contournée par l'exfiltration lente et fractionnée (*Low & Slow*).
* **L'approche par Machine Learning isolé en boîte noire** génère un taux de faux positifs intolérable et n'explique pas le contexte de l'incident à l'analyste SOC.
* **L'obscurité des logs bruts** : La prolifération de syntaxes hétérogènes (EventID Windows, TCC macOS, NGINX, PAM) ralentit l'investigation humaine.

---

## 2. Moteur Sémantique Enrichi & Multi-Niveaux (v2.3)

Le moteur sémantique de **DefuDelog v2.3** repose sur 5 piliers :

```text
                                  [ Log Brut Ingesté ]
                                           │
          ┌────────────────────────────────┴────────────────────────────────┐
          ▼                                                                 ▼
[ Moteur Sémantique Multi-Niveaux O(1) ]                [ Pipeline de Détection Multi-Axes ]
  ├── 1. Sens Métier Immédiat                             ├──> AXE 1 : DLP Déterministe (Regex O(1))
  ├── 2. Explication Didactique Approfondie               ├──> AXE 2 : Drain Structural & Zero-Day
  ├── 3. Recommandation Opérationnelle SOC                ├──> AXE 3 : Sémantique BGE (FastEmbed)
  ├──  Variables Nommées Typées ({user}, {ip}...)      ├──> AXE 4 : HDBSCAN Outlier Scoring
  ├──  Tolérance Floue (Token Jaccard >= 0.70)          └──> AXE 5 : Corrélation Temporelle
  ├──  Rétroaction en 1 Clic (SQLite Persistance)                         │
  └──  Synchronisation OTA du Dictionnaire                                ▼
          │                                                      [ Arbitrage Contextuel LLM ]
          ▼                                                                 │
┌──────────────────────────────┐                                            ▼
│ VUES LOGVIEWER DÉTAILLÉES    │                                  [ Alertes SIEM & SOAR ]
│ • Mode Vulgarisé / Hybride   │
│ • Surbrillance Intelligente  │
│ • Volet d'Investigation SOC  │
└──────────────────────────────┘
```

### 2.1. Les 3 Niveaux d'Interprétation
1. **Sens Métier Court (`meaning`)** : Résumé percutant en une phrase avec code visuel d'état (🟢 Succès, 🔵 Info, ⚠️ Warning, 🔴 Erreur).
2. **Explication Didactique (`explanation`)** : Vulgarisation technique détaillée de la cause de l'événement et du contexte système.
3. **Recommandation Opérationnelle SOC (`recommendation`)** : Guide d'action immédiat pour l'administrateur ou l'analyste de sécurité (règle pare-feu, révocation de clé, audit de compte).

### 2.2. Variables Nommées Typées (Zéro Inversion)
Les variables `{user}`, `{ip}`, `{port}`, `{file}`, `{table}`, `{status}`, `{app}`, `{domain}`, `{cmd}` sont extraites par des analyseurs syntaxiques spécialisés indépendamment de l'ordre d'apparition des champs dans la ligne de log.

### 2.3. Diagnostics PowerShell & Windows EventLog
Le dictionnaire intègre l'interprétation vulgarisée des erreurs de capture PowerShell (`CategoryInfo : [Get-WinEvent], EventLogException`, `FullyQualifiedErrorId : System.Diagnostics.Eventing.Reader.EventLogException`) pour guider immédiatement l'administrateur vers l'élévation UAC.

---

## 3. Mini-Widget Bureau Flottant (Desktop HUD)

DefuDelog intègre un cadran miniature autonome et interactif permettant de garder une surveillance constante sur l'activité sans encombrer l'écran :

```text
┌─────────────────────────────────────────────────────────────┐
│ [🔴] DefuDelog HUD  [LIVE]           11:20:45  [📌] [↗] [✕] │
├─────────────────────────────────────────────────────────────┤
│ 📈 Débit Flux Temps Réel : 48 logs/s                        │
│ ~~~~~~~~~~~~~~~~~/\_/\~~~~~~~~~~~~~~~~~ (Sparkline SVG)     │
├──────────────────────────────┬──────────────────────────────┤
│  Risque Fuite :  0         │  Authentification : 2      │
├──────────────────────────────┼──────────────────────────────┤
│  Anomalies :     1         │  Privilèges :       0      │
├──────────────────────────────┴──────────────────────────────┤
│  HDBSCAN + BGE Actif                       [ Console ⚡ ] │
└─────────────────────────────────────────────────────────────┘
```

### 3.1. Caractéristiques du Mini-Widget
- **Dimensions & Style** : 340 × 235 px, *Glassmorphism* sombre, frameless et coins arrondis.
- **Déplaçable librement** : Saisie à la souris sur l'en-tête ou le conteneur (`startDragging`).
- **Épinglage au Premier Plan** : Bouton d'épingle pour basculer le mode *Always on Top*.
- **Interaction Directe** : Cliquer sur une catégorie de menace ouvre instantanément la console principale sur la liste des alertes correspondantes.

---

## 4. Outils d'Expérience Utilisateur (UX)

### 4.1. Assistant Pas-à-Pas (*Quick-Setup Wizard*)
Accessible depuis le Dashboard, la barre latérale ou la palette de commandes, l'assistant guide l'utilisateur en 4 étapes :
1. **Environnement & Privilèges** : Diagnostic de l'OS et vérification des droits Administrateur (UAC).
2. **Activation des Sources** : Sélection des journaux d'audit Windows, écouteur Syslog UDP 514 et dossiers applicatifs.
3. **Calibrage IA HDBSCAN** : Profils de détection pré-calibrés (*Standard SOC*, *Haute Sensibilité DLP*, *Mode Discret*).
4. **Validation & Test** : Démarrage direct ou injection d'un jeu de simulation d'attaques.

### 4.2. Palette de Commandes Globale (`Ctrl + F` / `Cmd + F` / `Ctrl + K`)
- Barre de commandes interactive avec recherche floue.
- Raccourcis numériques `1` à `7` pour naviguer vers n'importe quelle page.
- Déclenchement d'actions rapides (ouvrir le HUD, injecter des logs, purger la base).
- Recherche textuelle universelle avec redirection vers le visualiseur de logs.

### 4.3. Mise en Surbrillance Automatique (*Smart Entity Highlighting*)
- Dans le visualiseur de logs, un clic sur un badge d'adresse IP ou de machine active la surbrillance dorée de toutes ses occurrences dans la table visible.
- Un bandeau contextuel permet d'appliquer instantanément un filtre strict sur l'entité sélectionnée.

---

## 5. Collecte Temps Réel & Surveillance Multi-OS

### 5.1. Démarrage Automatique
Dès son lancement, DefuDelog démarre immédiatement la collecte sur toutes les sources configurées et actives. Aucune manipulation manuelle n'est requise.

### 5.2. Prise en Charge Windows (Event Log)
- **Canaux standards** : `Application`, `System` sont collectés nativement.
- **Canal de Sécurité (`Security`)** : Requiert une élévation Administrateur pour lire les événements d'audit (EventID 4624, 4672, 4720).
- **Élévation UAC en 1 clic** : Le bouton *"Relancer en Administrateur"* dans l'interface déclenche l'élévation UAC Windows sans interruption.

### 5.3. macOS (Unified Log) & Linux (systemd-journald / Syslog)
- **macOS** : Collecte en flux continu via `log stream --style syslog` avec prédicats personnalisables.
- **Linux** : Streaming `journalctl --follow --output=short-iso` et suivi de fichiers (`/var/log/auth.log`, `/var/log/syslog`).

---

## 6. Intégration Apache Kafka & Connecteurs Réseau

DefuDelog s'intègre nativement dans une architecture d'entreprise via Apache Kafka pour le traitement haute cadence et la transmission aux SIEM centraux.

```text
       ┌───────────────────────────────┐
       │   Sources Externes / Serveurs │
       │ (Syslog, Agents, Firewalls...)│
       └──────────────┬────────────────┘
                      │ (Publie les logs bruts)
                      ▼
        [ Topic Inbound : `logs` ]
                      │
                      ▼ (DefuDelog Consomme en temps réel)
┌─────────────────────────────────────────────────────────────┐
│                       DefuDelog                             │
│  1. Parsing Drain (Extraction de Template)                  │
│  2. Moteur IA Multi-Axes (HDBSCAN + BGE + DLP Signatures)   │
│  3. Détection des Risques de Fuite DLP                      │
│  4. Enrichissement Sémantique & Remédiation SOAR            │
└─────────────────────────────┬───────────────────────────────┘
                              │ (Publie les logs enrichis et les alertes)
                              ▼
     [ Topic Outbound : `defudelog-alerts` ]
                              │
                              ▼
       ┌───────────────────────────────┐
       │     SOC / SIEM / Dashboard    │
       │ (Splunk, Elastic, Sentinel)   │
       └───────────────────────────────┘
```

---

## 7. Console Web LAN Embarquée (Accès Réseau Distant `IP:PORT`)

DefuDelog intègre un serveur Web HTTP asynchrone ultra-léger (en Rust / Tokio) permettant d'accéder au tableau de bord depuis n'importe quel ordinateur ou smartphone connecté au réseau local (LAN/Wi-Fi).

| Profil | Droits & Visibilité | Clé d'accès |
|---|---|:---:|
| **👑 Administrateur (Admin)** | **Accès intégral** : Tableau de bord, flux de logs, alertes DLP, règles de détection, découverte réseau et paramètres. | Clé 7 car. personnalisable ou régénérable (ex: `DF7K9QX`) |
| **👤 Utilisateur / Analyste (User)** | **Accès restreint** : Uniquement aux vues explicitement cochées depuis l'application desktop (Tableau de bord, Logs, Alertes, Réseau). | Clé 7 car. distincte (ex: `US4M2P8`) |

---

## 8. Matrice d'Efficacité & Probabilités de Détection

$$\text{Probabilité Combinée } P(\text{Détection}) = 1 - \prod_{i} (1 - P_i)$$

| Type de Menace / Log Suspect | Moteurs Déclencheurs Mobilisés | Probabilité de Détection | Niveau d'Alerte Résultant |
|---|---|:---:|:---:|
| **1. Risque de Fuite de Données / Exfiltration (DLP)**<br>*(dump SQL/CSV, upload S3, transfert cartes bancaires, fuite clé .pem)* | DLP Signatures + BGE Sémantique + Drain Critical + HDBSCAN | **99.8 %** | 🔴 **High** (SOAR, Kafka & Webhooks) |
| **2. Élévation de Privilèges**<br>*(chmod 777 /etc/shadow, sudoers, altération root)* | DLP Signatures + Drain Critical + BGE Sémantique | **99.4 %** | 🔴 **High** |
| **3. Attaque Force Brute / Authentification**<br>*(rafale sshd failed password, credential spraying PAM)* | Corrélation Temporelle + Drain Warning + BGE Auth Profile | **97.6 %** | 🟠 **Moderate** / 🔴 **High** |
| **4. Défaillance / Crash Système**<br>*(Out of Memory, kernel panic, segfault, HTTP 500)* | Drain Warning + BGE Sémantique + Signatures | **94.8 %** | 🟠 **Moderate** |
| **5. Menace Inconnue / Zero-Day (Sans mot-clé)**<br>*(commande exotique, comportement déviant inédit)* | Drain Template Inédit + HDBSCAN Outlier + BGE Écart Type | **86.2 %** | 🟡 **Low** ➔ 🟠 **Moderate** (après avis LLM) |
| **6. Trafic Opérationnel Normal (Bénin)**<br>*(requêtes HTTP 200 régulières, healthchecks applicatifs)* | Template Standard + Baseline HDBSCAN | **< 1.2 %** *(Faux Positif)* | 🟢 **Benign** (0 fausse alerte) |

---

## 9. Mises à Jour Automatiques OTA & Intégrité des Données

DefuDelog intègre un système de mises à jour automatisées en direct (**Over-The-Air / OTA**) avec double mécanisme de résilience :

1. **Zéro Perte de Données Garantie :**
   - La base de données SQLite `defudelog.db`, les règles personnalisées, les configurations et l'historique sont préservés dans le répertoire d'application sécurisé de l'OS.
   - Les mises à jour remplacent exclusivement le binaire exécutable.
2. **Double Vérification (Tauri Updater + Fallback GitHub Releases API) :**
   - Le moteur interroge d'abord le manifest updater natif. Si celui-ci est inaccessible, il bascule sur l'API publique GitHub Releases pour récupérer les binaires `.exe` / `.msi` / `.dmg` et les notes de version sans blocage.
   - Bouton de téléchargement & installation directe dans la page **Configuration**.
