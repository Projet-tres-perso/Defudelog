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
    engine: Option<std::sync::Arc<parking_lot::Mutex<crate::engine::DetectionPipeline>>>,
    translator: Option<std::sync::Arc<crate::translator::LogTranslator>>,
    app_handle: Option<tauri::AppHandle>,
    active_watchers: Vec<FileWatcherHandle>,
    running: bool,
}

struct FileWatcherHandle {
    source_id: String,
    thread: Option<thread::JoinHandle<()>>,
}

impl LogCollector {
    pub fn new(
        db: std::sync::Arc<Database>,
        engine: Option<std::sync::Arc<parking_lot::Mutex<crate::engine::DetectionPipeline>>>,
        translator: Option<std::sync::Arc<crate::translator::LogTranslator>>,
        app_handle: Option<tauri::AppHandle>,
    ) -> Self {
        Self {
            db,
            engine,
            translator,
            app_handle,
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
                    if let Ok(handle) = self.watch_file(&source, path) {
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
                    self.start_windows_collection(&source, channel, query.as_deref())?;
                }
                SourceType::Kafka { .. } => {
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
        let engine = self.engine.clone();
        let translator = self.translator.clone();
        let app_handle = self.app_handle.clone();
        let file_path = std::path::PathBuf::from(path);

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

            let read_new_lines = |pos: &mut u64| {
                match File::open(&file_path) {
                    Ok(mut file) => {
                        if let Ok(metadata) = file.metadata() {
                            if metadata.len() < *pos {
                                *pos = 0;
                            }

                            if file.seek(SeekFrom::Start(*pos)).is_ok() {
                                let reader = BufReader::new(file);
                                for line in reader.lines().map_while(Result::ok) {
                                    let line_len = line.len() as u64 + 1;
                                    if !line.trim().is_empty() {
                                        let _ = Self::ingest_line(
                                            &db,
                                            engine.as_ref(),
                                            translator.as_ref(),
                                            app_handle.as_ref(),
                                            &source_id_thread,
                                            &hostname,
                                            &line,
                                        );
                                    }
                                    *pos += line_len;
                                }
                            }
                        }
                    },
                    Err(e) => {
                        let err_msg = format!("[DefuDelog PERMISSION ERROR] Impossible de lire le fichier '{}' : {}", file_path.display(), e);
                        log::error!("{}", err_msg);
                        let _ = Self::ingest_line(&db, engine.as_ref(), translator.as_ref(), app_handle.as_ref(), &source_id_thread, &hostname, &err_msg);
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
        let engine = self.engine.clone();
        let translator = self.translator.clone();
        let app_handle = self.app_handle.clone();
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
                        for log_line in reader.lines().map_while(Result::ok) {
                            if !log_line.trim().is_empty() {
                                let _ = Self::ingest_line(
                                    &db,
                                    engine.as_ref(),
                                    translator.as_ref(),
                                    app_handle.as_ref(),
                                    &source_id,
                                    &hostname,
                                    &log_line,
                                );
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
        let engine = self.engine.clone();
        let translator = self.translator.clone();
        let app_handle = self.app_handle.clone();

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
                        for log_line in reader.lines().map_while(Result::ok) {
                            if !log_line.trim().is_empty() {
                                let _ = Self::ingest_line(
                                    &db,
                                    engine.as_ref(),
                                    translator.as_ref(),
                                    app_handle.as_ref(),
                                    &source_id,
                                    &hostname,
                                    &log_line,
                                );
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

    /// Collection sur Windows via wevtutil et PowerShell en streaming continu
    fn start_windows_collection(
        &self,
        source: &LogSource,
        channel: &str,
        _query: Option<&str>,
    ) -> AppResult<()> {
        let source_id = source.id.clone();
        let hostname = source.hostname.clone();
        let db = self.db.clone();
        let engine = self.engine.clone();
        let translator = self.translator.clone();
        let app_handle = self.app_handle.clone();
        let channel = channel.to_string();

        thread::spawn(move || {
            // Lecture initiale des 25 derniers événements existants pour éviter le cold-start vide
            let init_script = format!(
                r#"Get-WinEvent -LogName '{}' -MaxEvents 25 | Sort-Object TimeCreated | ForEach-Object {{ $_.TimeCreated.ToString('yyyy-MM-ddTHH:mm:ssZ') + ' [' + $_.LevelDisplayName + '] EventID=' + $_.Id + ' Provider=' + $_.ProviderName + ' ' + ($_.Message -replace '[\r\n]+', ' ') }}"#,
                channel
            );

            let mut init_cmd = std::process::Command::new("powershell");
            init_cmd.arg("-WindowStyle")
                .arg("Hidden")
                .arg("-NoProfile")
                .arg("-NonInteractive")
                .arg("-Command")
                .arg(&init_script);

            #[cfg(windows)]
            {
                use std::os::windows::process::CommandExt;
                init_cmd.creation_flags(0x08000000);
            }

            if let Ok(output) = init_cmd.output() {
                if !output.status.success() {
                    let err_text = String::from_utf8_lossy(&output.stderr);
                    if err_text.contains("Access is denied") || err_text.contains("accès est refusé") || err_text.contains("UnauthorizedAccess") {
                        let warn_msg = format!("[DefuDelog WARNING] Accès restreint au canal Windows '{}'. Lancez DefuDelog en tant qu'Administrateur pour surveiller ce canal.", channel);
                        let _ = Self::ingest_line(&db, engine.as_ref(), translator.as_ref(), app_handle.as_ref(), &source_id, &hostname, &warn_msg);
                    }
                } else {
                    let text = String::from_utf8_lossy(&output.stdout);
                    for line in text.lines() {
                        let trimmed = line.trim();
                        if !trimmed.is_empty() {
                            let _ = Self::ingest_line(
                                &db,
                                engine.as_ref(),
                                translator.as_ref(),
                                app_handle.as_ref(),
                                &source_id,
                                &hostname,
                                trimmed,
                            );
                        }
                    }
                }
            }

            // Suivi en continu des nouveaux événements
            let loop_script = format!(
                r#"$lastTime = (Get-Date).AddSeconds(-5); while($true) {{ $events = Get-WinEvent -FilterHashtable @{{LogName='{}'; StartTime=$lastTime}} -ErrorAction SilentlyContinue | Sort-Object TimeCreated; if ($events) {{ foreach ($e in $events) {{ $msg = $e.TimeCreated.ToString('yyyy-MM-ddTHH:mm:ssZ') + ' [' + $e.LevelDisplayName + '] EventID=' + $e.Id + ' Provider=' + $e.ProviderName + ' ' + ($e.Message -replace '[\r\n]+', ' '); [Console]::WriteLine($msg); }}; $lastTime = (Get-Date); }}; Start-Sleep -Milliseconds 1500; }}"#,
                channel
            );

            let mut cmd = std::process::Command::new("powershell");
            cmd.arg("-WindowStyle")
                .arg("Hidden")
                .arg("-NoProfile")
                .arg("-NonInteractive")
                .arg("-Command")
                .arg(&loop_script)
                .stdout(std::process::Stdio::piped());

            #[cfg(windows)]
            {
                use std::os::windows::process::CommandExt;
                cmd.creation_flags(0x08000000);
            }

            match cmd.spawn() {
                Ok(mut child) => {
                    if let Some(stdout) = child.stdout.take() {
                        use std::io::{BufRead, BufReader};
                        let reader = BufReader::new(stdout);
                        for log_line in reader.lines().map_while(Result::ok) {
                            let trimmed = log_line.trim();
                            if !trimmed.is_empty() {
                                let _ = Self::ingest_line(
                                    &db,
                                    engine.as_ref(),
                                    translator.as_ref(),
                                    app_handle.as_ref(),
                                    &source_id,
                                    &hostname,
                                    trimmed,
                                );
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

    /// Ingère une ligne de log, l'analyse via DetectionPipeline et émet un événement vers le frontend
    fn ingest_line(
        db: &Database,
        engine: Option<&std::sync::Arc<parking_lot::Mutex<crate::engine::DetectionPipeline>>>,
        translator: Option<&std::sync::Arc<crate::translator::LogTranslator>>,
        app_handle: Option<&tauri::AppHandle>,
        source_id: &str,
        hostname: &str,
        line: &str,
    ) -> Result<RawLog, AppError> {
        let log_hash = {
            let mut hasher = Sha256::new();
            hasher.update(line.as_bytes());
            format!("{:x}", hasher.finalize())
        };

        let now = Utc::now();

        // 1. Calcul du Sens Métier en français vulgarisé
        let (meaning, explanation, recommendation) = if let Some(tr) = translator {
            let (tpl, params) = if let Some(engine_lock) = engine {
                let mut eng = engine_lock.lock();
                let parsed = eng.parse_log_structure(line);
                (parsed.template, parsed.parameters)
            } else {
                (line.to_string(), Vec::new())
            };
            let trans = tr.translate(line, &tpl, &params);
            (Some(trans.meaning), trans.explanation, trans.recommendation)
        } else {
            (None, None, None)
        };

        let raw_log = RawLog {
            id: Uuid::new_v4().to_string(),
            source_id: source_id.to_string(),
            hostname: hostname.to_string(),
            raw_message: line.to_string(),
            log_hash,
            meaning,
            explanation,
            recommendation,
            timestamp: now,
            ingested_at: now,
        };

        // 2. Insertion SQLite chiffrée
        db.insert_raw_log(&raw_log)?;

        // 3. Traitement immédiat par le moteur d'IA multi-axes
        if let Some(engine_lock) = engine {
            let mut eng = engine_lock.lock();
            let _ = eng.process_log(source_id, hostname, line, now);
        }

        // 4. Diffusion temps réel vers le frontend
        if let Some(app) = app_handle {
            use tauri::Emitter;
            let _ = app.emit("log-ingested", &raw_log);
        }

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
                            pattern: Some("*".to_string()),
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
                            pattern: Some("*".to_string()),
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
                    Some("Le journal Windows Security requiert des privilèges Administrateur. Lancez DefuDelog en faisant 'Clic droit > Exécuter en tant qu'administrateur'.".to_string())
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
