# DeFuDoLog v2 — Data Leak Detection Platform

Plateforme desktop de détection de fuite de données par analyse multi-couche de logs (Endpoint & Network).

**Version 2.0** — Refonte complète en Tauri (Rust + React).

## Fonctionnalités Principales
- **Surveillance Multi-OS** : Fichiers plats, Journald (Linux), Unified Log (macOS), Event Log (Windows).
- **Auto-Découverte** : Détection automatique des sources de logs sensibles locales.
- **Surveillance Réseau (Nouveau)** : Serveur Syslog intégré (port 1514) pour ingérer les logs d'autres machines du réseau, et Sniffer réseau passif (`pnet`) pour détecter les anomalies de trafic.
- **Analyse Machine Learning** : Moteur IA natif 100% Rust embarquant des modèles LLM sémantiques (ONNX / Embeddings BGE), HDBSCAN, et corrélation temporelle adaptative (Exponential Decay).
- **Thème "Cyber Pro"** : Interface de type SOC (Security Operations Center) moderne.

## Architecture Globale

```text
DeFuDoLog v2
├── Frontend React (TypeScript, Tailwind CSS, Recharts)
│   ├── Dashboard — Statistiques et tendances en temps réel
│   ├── LogViewer — Exploration et recherche de logs
│   ├── Alerts — Gestion des alertes avec filtres et actions
│   ├── Sources — Configuration des sources multi-OS et Réseau
│   ├── Reports — Rapports LLM contextuels
│   └── Configuration — Paramétrage complet du moteur
│
├── Backend Rust (Tauri)
│   ├── DB Layer — SQLite optimisé (WAL, mmap, 12 tables)
│   ├── Collector — Collecte multi-OS (FileWatcher, Journald, macOS Log, Windows EventLog)
│   ├── Network — Sniffer réseau passif (pnet) et Syslog (1514)
│   ├── Engine — Drain-like parser, TF-IDF + RandomForest, DBSCAN, Isolation Forest
│   └── Commands — API Tauri pour le frontend
```

---

## Guide d'Installation Complète

### 1. Prérequis Système
- **Rust** (version 1.75 ou supérieure) : `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh`
- **Node.js** (version 20+ recommandée) et **npm** (10+).
- **Dépendances Spécifiques OS** :
  - **macOS** : Xcode Command Line Tools (`xcode-select --install`).
  - **Linux** : Librairies de développement requises (`sudo apt-get update && sudo apt-get install -y libwebkit2gtk-4.1-dev libgtk-3-dev libappindicator3-dev`).
  - **Windows** : Visual Studio Build Tools avec la charge de travail "Développement Desktop en C++", et le [Npcap SDK](https://npcap.com/) (requis pour le module de surveillance réseau `pnet`).

### 2. Compilation et Lancement

Clonez le dépôt, puis exécutez les commandes suivantes à la racine du projet :

```bash
# 1. Installation des dépendances du frontend (React)
npm install

# 2. Lancement en mode développement (Compile le backend Rust et lance l'app UI)
npm run tauri dev

# 3. Compilation pour la production (Génère un binaire optimisé pour votre OS)
npm run tauri build
```
*(L'exécutable final sera disponible dans le dossier `src-tauri/target/release/bundle/`)*

---

## Guide d'Utilisation

### 1. Configuration des sources locales (Endpoint)
Au premier lancement, l'application est vide. Rendez-vous dans l'onglet **Sources**.
- Cliquez sur **Auto-détecter hôte** : L'application scannera votre système et vous proposera de surveiller les fichiers de logs standards (ex: `auth.log`, `system.log`). Vous pouvez les accepter ou les ignorer.
- Vous pouvez ajouter manuellement n'importe quel fichier de log texte via le bouton **Ajouter une source**.

### 2. Surveiller d'autres machines du réseau (Syslog)
Vous n'avez pas besoin d'installer DeFuDoLog sur toutes les machines de votre parc !
1. Allez dans l'onglet **Sources** et activez le **Serveur Syslog Réseau**.
2. Sur n'importe quel routeur, pare-feu, ou serveur Linux distant, configurez l'envoi de ses logs vers l'adresse IP de la machine exécutant DeFuDoLog (port UDP/TCP 1514).
   *Exemple (Linux rsyslog) : Ajoutez `*.* @IP_DEFUDOLOG:1514` dans `/etc/rsyslog.conf` et redémarrez le service.*

### 3. Capture du trafic réseau (NDR)
L'application inclut un *sniffer* passif qui écoute le trafic de votre carte réseau pour extraire les métadonnées (IPs, Ports, Volume).
**Attention :** Pour que cette fonctionnalité fonctionne, vous devez exécuter l'application finale avec des privilèges élevés (Administrateur sous Windows, `sudo` sous Linux/Mac). Si elle est lancée normalement, cette fonctionnalité se désactivera silencieusement sans bloquer le reste de l'application.

### 4. Analyse et Alertes
Une fois les sources configurées, rendez-vous dans le **Dashboard** ou l'onglet **Alertes**. Le moteur de Machine Learning traitera les logs en arrière-plan. Lorsqu'un comportement aberrant est détecté (ex: exfiltration massive, changement de privilèges inhabituel), il fusionnera les scores d'anomalie et affichera une alerte classée par criticité.

---

## En savoir plus
Pour une analyse détaillée des algorithmes utilisés, des choix architecturaux et des principes de détection sous-jacents, veuillez consulter le fichier **[Manuel.md](./Manuel.md)**.

## Licence
MIT
