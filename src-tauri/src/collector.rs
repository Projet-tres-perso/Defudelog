#![allow(dead_code)]
use chrono::Utc;
use notify::{Config, Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use sha2::{Digest, Sha256};
use std::path::Path;
use std::sync::mpsc;
use std::thread;

use crate::db::Database;
use crate::error::{AppError, AppResult};
use crate::models::{DiscoveredSource, LogSource, PermissionStatus, RawLog, SourceType};
use uuid::Uuid;

/// Collecteur de logs unifié — multi-source, multi-OS
pub struct LogCollector {
    db: std::sync::Arc<Database>,
    active_watchers: Vec<FileWatcherHandle>,
    running: bool,
}

struct FileWatcherHandle {
    source_id: String,
    thread: Option<thread::JoinHandle<()>>,
}

impl LogCollector {
    pub fn new(db: std::sync::Arc<Database>) -> Self {
        Self {
            db,
            active_watchers: Vec::new(),
            running: false,
        }
    }

    /// Démarre la collecte pour toutes les sources actives
    pub fn start(&mut self) -> Result<(), AppError> {
        self.running = true;
        let sources = self.db.get_enabled_sources()?;

        for source in sources {
            match &source.source_type {
                SourceType::FileWatcher { path, pattern: _ } => {
                    if let Ok(handle) = self.watch_file(&source, &path) {
                        self.active_watchers.push(handle);
                    }
                }
                SourceType::MacOsUnifiedLog { predicate } => {
                    self.start_macos_collection(&source, predicate.as_deref())?;
                }
                SourceType::Journald { unit_filter: _ } => {
                    self.start_journald_collection(&source)?;
                }
                SourceType::WindowsEventLog { channel, query } => {
                    self.start_windows_collection(&source, &channel, query.as_deref())?;
                }
                SourceType::Kafka { .. } => {
                    // Kafka est géré séparément via le module kafka
                    log::info!("Kafka source {}: handled by kafka module", source.id);
                }
                SourceType::NetworkSyslog { .. } => {
                    log::info!("Network Syslog source {}: handled by SyslogServer", source.id);
                }
            }
        }

        Ok(())
    }

    /// Arrête tous les collecteurs
    pub fn stop(&mut self) {
        self.running = false;
        self.active_watchers.clear();
    }

    /// Surveille un fichier de logs avec notify
    fn watch_file(&self, source: &LogSource, path: &str) -> Result<FileWatcherHandle, AppError> {
        let source_id = source.id.clone();
        let db = self.db.clone();
        let file_path = std::path::PathBuf::from(path);

        // Vérifier que le fichier existe
        if !file_path.exists() {
            return Err(AppError::Collection(format!(
                "Fichier introuvable: {}",
                file_path.display()
            )));
        }

        let (tx, rx) = mpsc::channel();

        let mut watcher = RecommendedWatcher::new(
            move |res: Result<Event, notify::Error>| {
                if let Ok(event) = res {
                    let _ = tx.send(event);
                }
            },
            Config::default(),
        )
        .map_err(|e| AppError::Collection(format!("Erreur watcher: {}", e)))?;

        watcher
            .watch(&file_path, RecursiveMode::NonRecursive)
            .map_err(|e| AppError::Collection(format!("Erreur watch: {}", e)))?;

        let hostname = source.hostname.clone();
        let source_id_thread = source_id.clone();

        let handle = thread::spawn(move || {
            use std::io::{BufRead, BufReader, Seek, SeekFrom};
            use std::fs::File;

            let mut last_pos = 0;

            // Fonction pour lire les nouvelles lignes depuis last_pos
            let read_new_lines = |pos: &mut u64| {
                match File::open(&file_path) {
                    Ok(mut file) => {
                        if let Ok(metadata) = file.metadata() {
                            // Gérer la rotation de fichier (truncate)
                            if metadata.len() < *pos {
                                *pos = 0;
                            }

                            if let Ok(_) = file.seek(SeekFrom::Start(*pos)) {
                                let reader = BufReader::new(file);
                                for line in reader.lines() {
                                    if let Ok(line) = line {
                                        let line_len = line.len() as u64 + 1; // +1 pour le \n
                                        if !line.trim().is_empty() {
                                            let _ = Self::ingest_line(&db, &source_id_thread, &hostname, &line);
                                        }
                                        *pos += line_len;
                                    }
                                }
                            }
                        }
                    },
                    Err(e) => {
                        let err_msg = format!("[DEFUDOLOG PERMISSION ERROR] Impossible de lire le fichier source '{}' : {}. Vérifiez les droits d'accès ou l'Accès complet au disque.", file_path.display(), e);
                        log::error!("{}", err_msg);
                        let _ = Self::ingest_line(&db, &source_id_thread, &hostname, &err_msg);
                    }
                }
            };

            // Lecture initiale
            read_new_lines(&mut last_pos);

            // Suivi des nouvelles lignes
            for event in rx {
                if let EventKind::Modify(_) = event.kind {
                    read_new_lines(&mut last_pos);
                }
            }
        });

        Ok(FileWatcherHandle {
            source_id,
            thread: Some(handle),
        })
    }

    /// Collection sur macOS via la commande `log`
    fn start_macos_collection(
        &self,
        source: &LogSource,
        predicate: Option<&str>,
    ) -> AppResult<()> {
        let source_id = source.id.clone();
        let hostname = source.hostname.clone();
        let db = self.db.clone();
        let pred = predicate.unwrap_or("").to_string();

        thread::spawn(move || {
            let mut cmd = std::process::Command::new("log");
            cmd.arg("stream");
            cmd.arg("--style").arg("syslog");

            if !pred.is_empty() {
                cmd.arg("--predicate").arg(&pred);
            }

            match cmd.stdout(std::process::Stdio::piped()).spawn() {
                Ok(mut child) => {
                    if let Some(stdout) = child.stdout.take() {
                        use std::io::{BufRead, BufReader};
                        let reader = BufReader::new(stdout);
                        for line in reader.lines() {
                            if let Ok(log_line) = line {
                                let _ =
                                    Self::ingest_line(&db, &source_id, &hostname, &log_line);
                            }
                        }
                    }
                }
                Err(e) => {
                    log::error!("Erreur macOS log stream: {}", e);
                }
            }
        });

        Ok(())
    }

    /// Collection sur Linux via journalctl
    fn start_journald_collection(&self, source: &LogSource) -> AppResult<()> {
        let source_id = source.id.clone();
        let hostname = source.hostname.clone();
        let db = self.db.clone();

        thread::spawn(move || {
            let mut cmd = std::process::Command::new("journalctl");
            cmd.arg("--follow");
            cmd.arg("--output=short-iso");
            cmd.arg("--no-pager");

            match cmd.stdout(std::process::Stdio::piped()).spawn() {
                Ok(mut child) => {
                    if let Some(stdout) = child.stdout.take() {
                        use std::io::{BufRead, BufReader};
                        let reader = BufReader::new(stdout);
                        for line in reader.lines() {
                            if let Ok(log_line) = line {
                                let _ =
                                    Self::ingest_line(&db, &source_id, &hostname, &log_line);
                            }
                        }
                    }
                }
                Err(e) => {
                    log::error!("Erreur journalctl: {}", e);
                }
            }
        });

        Ok(())
    }

    /// Collection sur Windows via wevtutil
    fn start_windows_collection(
        &self,
        source: &LogSource,
        channel: &str,
        query: Option<&str>,
    ) -> AppResult<()> {
        let source_id = source.id.clone();
        let hostname = source.hostname.clone();
        let db = self.db.clone();
        let channel = channel.to_string();
        let _query_str = query.unwrap_or("*").to_string();

        thread::spawn(move || {
            // PowerShell one-liner pour suivre les événements Windows
            let ps_cmd = format!(
                r#"Get-WinEvent -FilterHashtable @{{LogName='{}'}} -MaxEvents 1 2>$null; while($true) {{ Get-WinEvent -FilterHashtable @{{LogName='{}'}} -MaxEvents 100 | ForEach-Object {{ $_.TimeCreated.ToString('o') + ' [' + $_.LevelDisplayName + '] ' + $_.Id + ': ' + $_.Message }} | Select-Object -Last 1; Start-Sleep -Seconds 2 }}"#,
                channel, channel
            );

            let mut cmd = std::process::Command::new("powershell");
            cmd.arg("-NoProfile")
                .arg("-Command")
                .arg(&ps_cmd)
                .stdout(std::process::Stdio::piped());

            match cmd.spawn() {
                Ok(mut child) => {
                    if let Some(stdout) = child.stdout.take() {
                        use std::io::{BufRead, BufReader};
                        let reader = BufReader::new(stdout);
                        for line in reader.lines() {
                            if let Ok(log_line) = line {
                                if !log_line.trim().is_empty() {
                                    let _ = Self::ingest_line(
                                        &db,
                                        &source_id,
                                        &hostname,
                                        &log_line,
                                    );
                                }
                            }
                        }
                    }
                }
                Err(e) => {
                    log::error!("Erreur Windows Event Log: {}", e);
                }
            }
        });

        Ok(())
    }

    /// Ingère une ligne de log dans la base de données
    fn ingest_line(
        db: &Database,
        source_id: &str,
        hostname: &str,
        line: &str,
    ) -> Result<RawLog, AppError> {
        let log_hash = {
            let mut hasher = Sha256::new();
            hasher.update(line.as_bytes());
            format!("{:x}", hasher.finalize())
        };

        let raw_log = RawLog {
            id: Uuid::new_v4().to_string(),
            source_id: source_id.to_string(),
            hostname: hostname.to_string(),
            raw_message: line.to_string(),
            log_hash,
            timestamp: Utc::now(),
            ingested_at: Utc::now(),
        };

        db.insert_raw_log(&raw_log)?;
        Ok(raw_log)
    }

    /// Vérifie si le collecteur tourne
    pub fn is_running(&self) -> bool {
        self.running
    }

    /// Liste et teste l'accessibilité de toutes les sources de logs critiques sur le système local
    pub fn discover_local_sources() -> Vec<DiscoveredSource> {
        let mut sources = Vec::new();
        let current_os = std::env::consts::OS;
        let hostname = get_hostname();

        // 1. MAC OS : Unified Log et fichiers systèmes
        if current_os == "macos" || current_os == "darwin" {
            // A. Apple Unified Log (Flux live d'authentification et session)
            sources.push(DiscoveredSource {
                id: Uuid::new_v4().to_string(),
                name: "macOS Unified Log (Auth & Sessions)".to_string(),
                category: "Authentification & Sessions".to_string(),
                source_type: SourceType::MacOsUnifiedLog {
                    predicate: Some("process == \"loginwindow\" OR process == \"sudo\" OR subsystem == \"com.apple.LocalAuthentication\"".to_string()),
                },
                target_path: "Apple Unified Log (Subsystems: loginwindow, sudo, LocalAuth)".to_string(),
                hostname: hostname.clone(),
                os: "macos".to_string(),
                status: PermissionStatus::Accessible,
                is_critical_security: true,
                permission_help: None,
                config: serde_json::json!({
                    "predicate": "process == \"loginwindow\" OR process == \"sudo\" OR subsystem == \"com.apple.LocalAuthentication\""
                }),
            });

            // B. Fichiers de logs macOS
            let macos_log_targets = [
                ("/var/log/system.log", "macOS System Log", "Système & Daemon", true),
                ("/var/log/wifi.log", "macOS Wi-Fi & Network Log", "Réseau", false),
                ("/var/log/install.log", "macOS Package Installer Log", "Installation & Root", true),
                ("/private/var/log/asl", "Apple System Log Archive (ASL)", "Système", false),
                ("/private/var/audit", "OpenBSM Security Audit Trail", "Audit Sécurité", true),
                ("/Library/Logs/DiagnosticReports", "macOS System Panic & Crash Reports", "Anomalie Système", true),
            ];

            for (path, name, category, is_critical) in &macos_log_targets {
                let p = Path::new(path);
                if p.exists() {
                    let (status, help) = match std::fs::File::open(p) {
                        Ok(_) => (PermissionStatus::Accessible, None),
                        Err(e) if e.kind() == std::io::ErrorKind::PermissionDenied => (
                            PermissionStatus::PermissionDenied,
                            Some(format!(
                                "Accès restreint par macOS. Accordez l'Accès complet au disque dans 'Réglages Système > Confidentialité et sécurité > Accès complet au disque' ou exécutez dans le Terminal : sudo chmod +r {}",
                                path
                            )),
                        ),
                        Err(_) => (PermissionStatus::NotFound, None),
                    };

                    sources.push(DiscoveredSource {
                        id: Uuid::new_v4().to_string(),
                        name: name.to_string(),
                        category: category.to_string(),
                        source_type: SourceType::FileWatcher {
                            path: path.to_string(),
                            pattern: "*".to_string(),
                        },
                        target_path: path.to_string(),
                        hostname: hostname.clone(),
                        os: "macos".to_string(),
                        status,
                        is_critical_security: *is_critical,
                        permission_help: help,
                        config: serde_json::json!({"path": path}),
                    });
                }
            }
        }

        // 2. LINUX : systemd-journald et /var/log/*
        if current_os == "linux" {
            // A. systemd-journald
            let journal_available = Path::new("/run/systemd/journal").exists() || Path::new("/var/log/journal").exists();
            if journal_available {
                sources.push(DiscoveredSource {
                    id: Uuid::new_v4().to_string(),
                    name: "Linux systemd-journald".to_string(),
                    category: "Système & Services".to_string(),
                    source_type: SourceType::Journald { unit_filter: None },
                    target_path: "systemd-journald".to_string(),
                    hostname: hostname.clone(),
                    os: "linux".to_string(),
                    status: PermissionStatus::Accessible,
                    is_critical_security: true,
                    permission_help: None,
                    config: serde_json::json!({}),
                });
            }

            // B. Fichiers standards Linux
            let linux_log_targets = [
                ("/var/log/auth.log", "Linux Authentication Log (Debian/Ubuntu)", "Authentification & PAM", true),
                ("/var/log/secure", "Linux Security & Auth Log (RHEL/CentOS)", "Authentification & PAM", true),
                ("/var/log/audit/audit.log", "Linux Audit Daemon (auditd)", "Audit Sécurité Kernel", true),
                ("/var/log/syslog", "Linux System Log (Syslog)", "Système Général", false),
                ("/var/log/messages", "Linux Messages Log (RHEL/CentOS)", "Système Général", false),
                ("/var/log/kern.log", "Linux Kernel Messages", "Noyau & Matériel", true),
                ("/var/log/ufw.log", "UFW Firewall Log", "Pare-feu & Réseau", false),
                ("/var/log/nginx/access.log", "Nginx Web Server Access", "Serveur Web", false),
                ("/var/log/nginx/error.log", "Nginx Web Server Error", "Serveur Web", true),
                ("/var/log/apache2/access.log", "Apache Web Server Access", "Serveur Web", false),
                ("/var/log/apache2/error.log", "Apache Web Server Error", "Serveur Web", true),
            ];

            for (path, name, category, is_critical) in &linux_log_targets {
                let p = Path::new(path);
                if p.exists() {
                    let (status, help) = match std::fs::File::open(p) {
                        Ok(_) => (PermissionStatus::Accessible, None),
                        Err(e) if e.kind() == std::io::ErrorKind::PermissionDenied => (
                            PermissionStatus::PermissionDenied,
                            Some(format!(
                                "Droits d'accès insuffisants sous Linux. Ajoutez votre utilisateur aux groupes d'administration : 'sudo usermod -aG adm,systemd-journal $USER' puis redémarrez votre session, ou lancez : sudo chmod +r {}",
                                path
                            )),
                        ),
                        Err(_) => (PermissionStatus::NotFound, None),
                    };

                    sources.push(DiscoveredSource {
                        id: Uuid::new_v4().to_string(),
                        name: name.to_string(),
                        category: category.to_string(),
                        source_type: SourceType::FileWatcher {
                            path: path.to_string(),
                            pattern: "*".to_string(),
                        },
                        target_path: path.to_string(),
                        hostname: hostname.clone(),
                        os: "linux".to_string(),
                        status,
                        is_critical_security: *is_critical,
                        permission_help: help,
                        config: serde_json::json!({"path": path}),
                    });
                }
            }
        }

        // 3. WINDOWS : Event Logs (Security, System, PowerShell, Sysmon)
        if current_os == "windows" {
            let win_channels = [
                ("Security", "Windows Security Event Log (Logons, Privileges)", "Authentification & Sécurité", true, true),
                ("System", "Windows System Event Log", "Système & Services", false, false),
                ("Application", "Windows Application Event Log", "Applications", false, false),
                ("Microsoft-Windows-PowerShell/Operational", "PowerShell Script Execution Log", "Exécution de Scripts", true, false),
                ("Microsoft-Windows-Sysmon/Operational", "Sysmon Deep Telemetry Log", "Télémétrie Avancée", true, true),
            ];

            for (channel, name, category, is_critical, requires_admin) in &win_channels {
                let status = if *requires_admin {
                    PermissionStatus::RequiresElevation
                } else {
                    PermissionStatus::Accessible
                };

                let help = if *requires_admin {
                    Some("Le journal Windows Security requiert des privilèges Administrateur. Lancez DeFuDoLog en faisant 'Clic droit > Exécuter en tant qu'administrateur'.".to_string())
                } else {
                    None
                };

                sources.push(DiscoveredSource {
                    id: Uuid::new_v4().to_string(),
                    name: name.to_string(),
                    category: category.to_string(),
                    source_type: SourceType::WindowsEventLog {
                        channel: channel.to_string(),
                        query: None,
                    },
                    target_path: format!("EventLog Channel: {}", channel),
                    hostname: hostname.clone(),
                    os: "windows".to_string(),
                    status,
                    is_critical_security: *is_critical,
                    permission_help: help,
                    config: serde_json::json!({"channel": channel}),
                });
            }
        }

        sources
    }
}

fn get_hostname() -> String {
    #[cfg(unix)]
    {
        let mut buf = vec![0u8; 256];
        unsafe {
            let ret = libc::gethostname(buf.as_mut_ptr() as *mut libc::c_char, buf.len());
            if ret == 0 {
                let end = buf.iter().position(|&b| b == 0).unwrap_or(buf.len());
                buf.truncate(end);
                return String::from_utf8_lossy(&buf).to_string();
            }
        }
    }
    #[cfg(windows)]
    {
        if let Ok(h) = std::env::var("COMPUTERNAME") {
            return h;
        }
    }
    "localhost".to_string()
}
