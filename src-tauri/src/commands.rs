use crate::models::*;
use chrono::Utc;
use tauri::State;

// AppState is in lib.rs - accessed via managed state
type AppState = crate::AppState;

// ─── Helpers ─────────────────────────────────────────

fn parse_source_type(t: &str, config: &serde_json::Value) -> SourceType {
    match t.to_lowercase().replace('_', "").as_str() {
        "filewatcher" => SourceType::FileWatcher {
            path: config["path"].as_str().unwrap_or("").into(),
            pattern: config["pattern"].as_str().map(|s| s.into()),
        },
        "journald" => SourceType::Journald {
            unit_filter: config["unit_filter"].as_str().map(|s| s.into()),
        },
        "macosunifiedlog" => SourceType::MacOsUnifiedLog {
            predicate: config["predicate"].as_str().map(|s| s.into()),
        },
        "windowseventlog" => SourceType::WindowsEventLog {
            channel: config["channel"].as_str().unwrap_or("Security").into(),
            query: config["query"].as_str().map(|s| s.into()),
        },
        "networksyslog" => SourceType::NetworkSyslog {
            port: config["port"].as_u64().unwrap_or(1514) as u16,
            protocol: config["protocol"].as_str().unwrap_or("udp/tcp").into(),
        },
        "kafka" => SourceType::Kafka {
            topic: config["topic"].as_str().unwrap_or("logs").into(),
            brokers: config["brokers"].as_array()
                .map(|a| a.iter().filter_map(|v| v.as_str().map(String::from)).collect())
                .unwrap_or_default(),
        },
        _ => SourceType::FileWatcher {
            path: config["path"].as_str().unwrap_or("").into(),
            pattern: config["pattern"].as_str().map(|s| s.into()),
        },
    }
}

fn to_severity(s: &str) -> AlertLevel {
    match s {
        "high" => AlertLevel::High,
        "moderate" => AlertLevel::Moderate,
        "low" => AlertLevel::Low,
        _ => AlertLevel::Low,
    }
}

// ─── Source Management ─────────────────────────────

#[tauri::command]
pub fn add_log_source(state: State<'_, AppState>, name: String, source_type: String,
    hostname: String, os: String, config: serde_json::Value) -> Result<LogSource, String>
{
    let resolved_source_type = parse_source_type(&source_type, &config);
    let source = LogSource {
        id: uuid::Uuid::new_v4().to_string(),
        name,
        source_type: resolved_source_type,
        hostname,
        os,
        enabled: true,
        priority: "normal".to_string(),
        config,
        created_at: Utc::now(),
        updated_at: Utc::now(),
    };
    state.db.insert_log_source(&source).map_err(|e| e.to_string())?;

    // Recharger et démarrer immédiatement la surveillance à chaud
    let mut collector = state.collector.lock();
    collector.stop();
    let _ = collector.start();

    Ok(source)
}

#[tauri::command]
pub fn list_log_sources(state: State<'_, AppState>) -> Result<Vec<LogSource>, String> {
    state.db.get_log_sources().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn toggle_log_source(state: State<'_, AppState>, source_id: String, enabled: bool) -> Result<(), String> {
    state.db.update_source_enabled(&source_id, enabled).map_err(|e| e.to_string())?;
    
    // Recharger à chaud le collecteur
    let mut collector = state.collector.lock();
    collector.stop();
    let _ = collector.start();
    Ok(())
}

#[tauri::command]
pub fn delete_log_source(state: State<'_, AppState>, source_id: String) -> Result<(), String> {
    state.db.delete_log_source(&source_id).map_err(|e| e.to_string())?;
    
    // Recharger à chaud le collecteur
    let mut collector = state.collector.lock();
    collector.stop();
    let _ = collector.start();
    Ok(())
}

#[tauri::command]
pub fn auto_discover_host_sources(_state: State<'_, AppState>) -> Result<Vec<DiscoveredSource>, String> {
    let discovered = crate::collector::LogCollector::discover_local_sources();
    Ok(discovered)
}

#[tauri::command]
pub fn check_source_permission(_state: State<'_, AppState>, path: String) -> Result<serde_json::Value, String> {
    let p = std::path::Path::new(&path);
    if !p.exists() {
        return Ok(serde_json::json!({
            "status": "not_found",
            "readable": false,
            "message": "Le fichier spécifié n'existe pas sur le système."
        }));
    }

    match std::fs::File::open(p) {
        Ok(_) => Ok(serde_json::json!({
            "status": "accessible",
            "readable": true,
            "message": "Fichier accessible en lecture."
        })),
        Err(e) if e.kind() == std::io::ErrorKind::PermissionDenied => {
            let os = std::env::consts::OS;
            let help = match os {
                "macos" | "darwin" => format!("Accès refusé par macOS. Accordez l'Accès complet au disque dans 'Réglages Système > Confidentialité et sécurité > Accès complet au disque' ou lancez dans le Terminal : sudo chmod +r {}", path),
                "linux" => format!("Accès refusé sous Linux. Ajoutez votre compte aux groupes d'audit : 'sudo usermod -aG adm,systemd-journal $USER' ou lancez : sudo chmod +r {}", path),
                "windows" => "Accès refusé sous Windows. Lancez l'application en mode Administrateur ('Exécuter en tant qu'administrateur').".to_string(),
                _ => "Permissions insuffisantes pour lire ce fichier.".to_string(),
            };
            Ok(serde_json::json!({
                "status": "permission_denied",
                "readable": false,
                "message": help
            }))
        },
        Err(e) => Ok(serde_json::json!({
            "status": "error",
            "readable": false,
            "message": format!("Erreur d'accès : {}", e)
        })),
    }
}

#[tauri::command]
pub fn get_network_nodes(state: State<'_, AppState>) -> Result<Vec<NetworkNode>, String> {
    state.db.get_network_nodes().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn start_syslog_server(state: State<'_, AppState>) -> Result<(), String> {
    state.syslog_server.start().await
}

#[tauri::command]
pub fn stop_syslog_server(state: State<'_, AppState>) -> Result<(), String> {
    state.syslog_server.stop();
    Ok(())
}

#[tauri::command]
pub fn start_monitoring(state: State<'_, AppState>) -> Result<(), String> {
    let mut collector = state.collector.lock();
    collector.start().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn stop_monitoring(state: State<'_, AppState>) -> Result<(), String> {
    let mut collector = state.collector.lock();
    collector.stop();
    Ok(())
}

#[tauri::command]
pub fn get_monitoring_status(state: State<'_, AppState>) -> Result<serde_json::Value, String> {
    let collector = state.collector.lock();
    let sources = state.db.get_enabled_sources().map_err(|e| e.to_string())?;
    Ok(serde_json::json!({
        "monitoring": collector.is_running(),
        "sources_count": sources.len(),
        "syslog_running": state.syslog_server.is_running(),
    }))
}

#[tauri::command]
pub fn get_syslog_status(state: State<'_, AppState>) -> Result<serde_json::Value, String> {
    Ok(serde_json::json!({
        "running": state.syslog_server.is_running(),
        "port": 1514,
        "protocol": "UDP/TCP",
    }))
}

// ─── Log Retrieval ─────────────────────────────────

/// Accepte les deux conventions d'appel:
/// - Dashboard: { limit, offset, query, sourceId }
/// - LogViewer: { page, perPage, search }
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn get_raw_logs(
    state: State<'_, AppState>,
    limit: Option<usize>,
    offset: Option<usize>,
    page: Option<usize>,
    per_page: Option<usize>,
    search: Option<String>,
    query: Option<String>,
    source_id: Option<String>,
) -> Result<serde_json::Value, String>
{
    // Résoudre les paramètres de manière rétrocompatible
    let effective_search = search.or(query);
    let (effective_limit, effective_offset) = if let Some(lim) = limit {
        (lim, offset.unwrap_or(0))
    } else {
        let p = page.unwrap_or(1);
        let pp = per_page.unwrap_or(50);
        (pp, (p - 1) * pp)
    };

    let (logs, total) = state.db.get_raw_logs(
        effective_limit,
        effective_offset,
        source_id.as_deref(),
        effective_search.as_deref(),
    ).map_err(|e| e.to_string())?;

    let effective_page = effective_offset.checked_div(effective_limit).map(|v| v + 1).unwrap_or(1);

    Ok(serde_json::json!({
        "logs": logs,
        "total": total,
        "page": effective_page,
        "per_page": effective_limit,
        "total_pages": if effective_limit > 0 { (total as f64 / effective_limit as f64).ceil() as u64 } else { 1 },
    }))
}

// ─── Alert Management ──────────────────────────────

#[tauri::command]
pub fn get_alerts(state: State<'_, AppState>, page: Option<usize>, per_page: Option<usize>,
    level: Option<String>, acknowledged: Option<bool>) -> Result<serde_json::Value, String>
{
    let page = page.unwrap_or(1);
    let per_page = per_page.unwrap_or(50);
    let offset = (page - 1) * per_page;
    let (alerts, total) = state.db.get_alerts(level.as_deref(), acknowledged, per_page, offset)
        .map_err(|e| e.to_string())?;
    Ok(serde_json::json!({
        "alerts": alerts, "total": total, "page": page, "per_page": per_page,
        "total_pages": (total as f64 / per_page as f64).ceil() as u64,
    }))
}

#[tauri::command]
pub fn acknowledge_alert(state: State<'_, AppState>, alert_id: String) -> Result<(), String> {
    state.db.acknowledge_alert(&alert_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn dismiss_alert(state: State<'_, AppState>, alert_id: String) -> Result<(), String> {
    state.db.acknowledge_alert(&alert_id).map_err(|e| e.to_string())
}

// ─── Dashboard ─────────────────────────────────────

#[tauri::command]
pub fn get_dashboard_stats(state: State<'_, AppState>) -> Result<DashboardStats, String> {
    state.db.get_dashboard_stats().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_template_stats(state: State<'_, AppState>) -> Result<Vec<TemplateFrequency>, String> {
    let stats = state.db.get_dashboard_stats().map_err(|e| e.to_string())?;
    Ok(stats.top_templates)
}

#[tauri::command]
pub fn get_timeseries_stats(state: State<'_, AppState>) -> Result<Vec<TimeSeriesPoint>, String> {
    state.db.get_timeseries_stats().map_err(|e| e.to_string())
}

// ─── Detection Engine ──────────────────────────────

#[tauri::command]
pub fn run_detection(state: State<'_, AppState>) -> Result<String, String> {
    let (logs, _) = state.db.get_raw_logs(500, 0, None, None).map_err(|e| e.to_string())?;
    let batch: Vec<(String, String, String, chrono::DateTime<Utc>)> = logs
        .into_iter().map(|l| (l.source_id, l.hostname, l.raw_message, l.timestamp)).collect();
    let mut engine = state.engine.lock();
    let alerts = engine.process_batch(batch).map_err(|e| e.to_string())?;
    Ok(format!("Detection: {} logs, {} alerts", 500, alerts.len()))
}

#[tauri::command]
pub fn run_detection_on_range(state: State<'_, AppState>, _start_ts: String, _end_ts: String)
    -> Result<String, String>
{
    let (logs, _) = state.db.get_raw_logs(1000, 0, None, None).map_err(|e| e.to_string())?;
    let batch: Vec<(String, String, String, chrono::DateTime<Utc>)> = logs
        .into_iter().map(|l| (l.source_id, l.hostname, l.raw_message, l.timestamp)).collect();
    let mut engine = state.engine.lock();
    let alerts = engine.process_batch(batch).map_err(|e| e.to_string())?;
    Ok(format!("Detection complete: {} alerts", alerts.len()))
}

// ─── Detection Rules ───────────────────────────────

#[tauri::command]
pub fn add_detection_rule(state: State<'_, AppState>, name: String, description: String,
    rule_type: String, pattern: String, severity: String) -> Result<DetectionRule, String>
{
    let rule = DetectionRule {
        id: uuid::Uuid::new_v4().to_string(), name, description,
        rule_type: match rule_type.as_str() {
            "keyword" => RuleType::Keyword, "ip_blacklist" => RuleType::IpBlacklist,
            "user_blacklist" => RuleType::UserBlacklist, "time_window" => RuleType::TimeWindow,
            "regex" => RuleType::Regex, "template_match" => RuleType::TemplateMatch,
            _ => RuleType::Keyword,
        },
        pattern, severity: to_severity(&severity), enabled: true, created_at: Utc::now(),
    };
    state.db.upsert_rule(&rule).map_err(|e| e.to_string())?;
    Ok(rule)
}

#[tauri::command]
pub fn list_rules(state: State<'_, AppState>) -> Result<Vec<DetectionRule>, String> {
    state.db.get_rules().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn toggle_rule(state: State<'_, AppState>, rule_id: String, enabled: bool) -> Result<(), String> {
    state.db.update_rule_enabled(&rule_id, enabled).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_rule(state: State<'_, AppState>, rule_id: String) -> Result<(), String> {
    state.db.delete_rule(&rule_id).map_err(|e| e.to_string())
}

// ─── Settings ──────────────────────────────────────

#[tauri::command]
pub fn get_settings(state: State<'_, AppState>) -> Result<AppSettings, String> {
    let s = state.settings.lock();
    Ok(s.clone())
}

#[tauri::command]
pub async fn update_settings(state: State<'_, AppState>, settings: AppSettings) -> Result<(), String> {
    let lan_settings = settings.lan_server.clone();
    state.lan_server.update_settings(lan_settings.clone());

    if lan_settings.enabled && !state.lan_server.is_running() {
        let _ = state.lan_server.start().await;
    } else if !lan_settings.enabled && state.lan_server.is_running() {
        state.lan_server.stop();
    }

    let mut current = state.settings.lock();
    *current = settings;
    state.db.save_settings(&current).map_err(|e| e.to_string())
}

// ─── LAN Web Server ────────────────────────────────

#[tauri::command]
pub async fn start_lan_server(state: State<'_, AppState>) -> Result<String, String> {
    state.lan_server.start().await
}

#[tauri::command]
pub fn stop_lan_server(state: State<'_, AppState>) -> Result<(), String> {
    state.lan_server.stop();
    Ok(())
}

#[tauri::command]
pub fn get_lan_server_status(state: State<'_, AppState>) -> Result<serde_json::Value, String> {
    let s = state.lan_server.get_settings();
    let is_running = state.lan_server.is_running();
    let local_ip = crate::web_server::LanWebServer::get_local_ip();
    let url = format!("http://{}:{}", local_ip, s.port);

    Ok(serde_json::json!({
        "is_running": is_running,
        "port": s.port,
        "local_ip": local_ip,
        "url": url,
        "admin_username": s.admin_username,
        "admin_access_key": s.admin_access_key,
        "user_username": s.user_username,
        "user_access_key": s.user_access_key,
        "user_allowed_views": s.user_allowed_views,
    }))
}

#[tauri::command]
pub fn generate_random_access_key() -> Result<String, String> {
    use rand::Rng;
    const CHARSET: &[u8] = b"ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // 31 caractères lisibles sans ambiguïté (pas de O, 0, 1, I)
    let mut rng = rand::thread_rng();
    let key: String = (0..7)
        .map(|_| {
            let idx = rng.gen_range(0..CHARSET.len());
            CHARSET[idx] as char
        })
        .collect();
    Ok(key)
}

#[tauri::command]
pub fn purge_old_logs(
    state: State<'_, AppState>,
    days: u32,
    archive: bool,
    archive_dir: Option<String>,
) -> Result<PurgeResult, String> {
    let dir = archive_dir.unwrap_or_else(|| "archives".to_string());
    state.db.purge_logs(days, archive, &dir).map_err(|e| e.to_string())
}

// ─── Context & Templates ───────────────────────────

#[tauri::command]
pub fn get_log_context(state: State<'_, AppState>, log_id: String,
    before: Option<usize>, _after: Option<usize>) -> Result<Vec<RawLog>, String>
{
    let limit = before.unwrap_or(10);
    state.db.get_log_context_neighbors(&log_id, None, None, limit).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn generate_demo_logs(state: State<'_, AppState>) -> Result<serde_json::Value, String> {
    let now = Utc::now();
    let demo_raw_logs = vec![
        // 1. Data Leak
        ("srv-db-01", "2026-08-03T10:00:00Z [EXFILTRATION] User cyrus exported 50000 customer records to s3://external-backup-leak/dump.csv"),
        ("srv-db-01", "2026-08-03T10:01:00Z [DATA_LEAK] Transferring sensitive dataset credit_cards.db (1.2GB) via curl to 185.220.101.5"),

        // 2. Authentication / Brute Force
        ("fw-core-01", "2026-08-03T10:02:10Z sshd[4412]: Failed password for invalid user admin from 192.168.1.105 port 51234 ssh2"),
        ("fw-core-01", "2026-08-03T10:02:12Z sshd[4415]: Failed password for invalid user root from 192.168.1.105 port 51236 ssh2"),
        ("fw-core-01", "2026-08-03T10:02:15Z sshd[4420]: Failed password for invalid user user1 from 192.168.1.105 port 51240 ssh2"),
        ("fw-core-01", "2026-08-03T10:02:18Z sshd[4425]: PAM authentication failure for user root from 192.168.1.105"),

        // 3. Privilege Escalation
        ("srv-app-02", "2026-08-03T10:05:00Z sudo: cyrus : TTY=pts/1 ; PWD=/home/cyrus ; USER=root ; COMMAND=/bin/chmod 777 /etc/shadow"),
        ("srv-app-02", "2026-08-03T10:05:30Z sudo: cyrus : TTY=pts/1 ; PWD=/home/cyrus ; USER=root ; COMMAND=/bin/bash"),

        // 4. System Anomaly / Crash
        ("srv-web-01", "2026-08-03T10:10:00Z kernel: Out of Memory: Kill process 12498 (nginx) score 920 or sacrifice child"),
        ("srv-web-01", "2026-08-03T10:10:05Z systemd[1]: nginx.service: Main process exited, code=exited, status=500/INTERNAL_ERROR"),

        // 5. Normal traffic
        ("srv-web-01", "2026-08-03T10:12:00Z 192.168.1.20 - - [03/Aug/2026:10:12:00 +0000] \"GET /dashboard HTTP/1.1\" 200 4523"),
        ("srv-web-01", "2026-08-03T10:12:05Z 192.168.1.25 - - [03/Aug/2026:10:12:05 +0000] \"GET /api/v1/health HTTP/1.1\" 200 120"),
    ];

    let mut batch = Vec::new();
    let mut registered_hosts = std::collections::HashSet::new();

    for (hostname, log_str) in &demo_raw_logs {
        let source_id = format!("demo_source_{}", hostname);
        if registered_hosts.insert(hostname) {
            let demo_source = LogSource {
                id: source_id.clone(),
                name: format!("Source Démo ({})", hostname),
                source_type: SourceType::FileWatcher { path: "/var/log/demo.log".to_string(), pattern: Some("*.log".to_string()) },
                hostname: hostname.to_string(),
                os: "demo".to_string(),
                enabled: true,
                priority: "normal".to_string(),
                config: serde_json::json!({}),
                created_at: now,
                updated_at: now,
            };
            let _ = state.db.insert_log_source(&demo_source);
        }

        batch.push((
            source_id,
            hostname.to_string(),
            log_str.to_string(),
            now,
        ));
    }

    let mut engine = state.engine.lock();
    let alerts = engine.process_batch(batch).map_err(|e| e.to_string())?;

    Ok(serde_json::json!({
        "generated_logs": demo_raw_logs.len(),
        "generated_alerts": alerts.len(),
        "alerts": alerts,
    }))
}

#[tauri::command]
pub fn export_alerts_siem(state: State<'_, AppState>, format: String) -> Result<String, String> {
    let alerts = state.db.get_alerts(None, None, 1000, 0).map_err(|e| e.to_string())?;
    let exported = crate::siem_exporter::SiemExporter::export_batch(&alerts.0, &format);
    Ok(exported)
}

#[tauri::command]
pub async fn test_webhook(url: String) -> Result<String, String> {
    crate::webhook_notifier::WebhookNotifier::test_webhook_url(&url).await?;
    Ok("Notification de test envoyée avec succès !".to_string())
}

#[tauri::command]
pub async fn test_llm_connection(settings: LlmSettings) -> Result<String, String> {
    if settings.base_url.trim().is_empty() {
        return Err("L'URL de base du LLM ne peut pas être vide.".to_string());
    }

    let client = match reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(8))
        .build()
    {
        Ok(c) => c,
        Err(e) => return Err(format!("Erreur initialisation client HTTP: {}", e)),
    };

    let base_url = settings.base_url.trim_end_matches('/');
    let api_url = if base_url.ends_with("/chat/completions") {
        base_url.to_string()
    } else if base_url.ends_with("/v1") {
        format!("{}/chat/completions", base_url)
    } else {
        // Essayer /chat/completions par défaut
        format!("{}/chat/completions", base_url)
    };

    let model_name = if settings.model.trim().is_empty() {
        "llama3"
    } else {
        settings.model.trim()
    };

    let mut req = client.post(&api_url).json(&serde_json::json!({
        "model": model_name,
        "messages": [
            {"role": "system", "content": "Tu es un assistant de test. Réponds 'OK'."},
            {"role": "user", "content": "Ping"}
        ],
        "max_tokens": 10,
        "temperature": 0.1
    }));

    if !settings.api_key.trim().is_empty() {
        req = req.header("Authorization", format!("Bearer {}", settings.api_key.trim()));
    }

    match req.send().await {
        Ok(res) => {
            if res.status().is_success() {
                let json_res: Result<serde_json::Value, _> = res.json().await;
                if let Ok(val) = json_res {
                    let reply = val["choices"][0]["message"]["content"]
                        .as_str()
                        .unwrap_or("Connexion réussie")
                        .trim();
                    Ok(format!("Connexion réussie ! Réponse du modèle ({}) : \"{}\"", model_name, reply))
                } else {
                    Ok(format!("Connexion réussie au serveur LLM (Modèle: {})", model_name))
                }
            } else {
                let status = res.status();
                let err_text = res.text().await.unwrap_or_default();
                Err(format!("Erreur serveur LLM HTTP {} : {}", status, err_text.chars().take(120).collect::<String>()))
            }
        }
        Err(e) => {
            Err(format!("Impossible de joindre le serveur LLM à '{}' : {}. Vérifiez que le serveur (Ollama / LM Studio / LocalAI) est démarré.", api_url, e))
        }
    }
}

#[tauri::command]
pub fn test_soar_script(script: String) -> Result<String, String> {
    if script.trim().is_empty() {
        return Err("Le contenu du script SOAR ne peut pas être vide.".to_string());
    }
    crate::active_response::ActiveResponseEngine::execute_script(
        &script,
        "TEST-ALERT-001",
        "data_leak",
    )
    .map_err(|e| format!("Erreur lors de l'exécution du script SOAR: {}", e))?;

    Ok("Script SOAR de test exécuté avec succès en tâche de fond !".to_string())
}

#[tauri::command]
pub fn get_templates(state: State<'_, AppState>, page: Option<usize>, per_page: Option<usize>)
    -> Result<serde_json::Value, String>
{
    let stats = state.db.get_dashboard_stats().map_err(|e| e.to_string())?;
    let page = page.unwrap_or(1);
    let per_page = per_page.unwrap_or(50);
    let total = stats.top_templates.len() as u64;
    Ok(serde_json::json!({
        "templates": stats.top_templates, "total": total, "page": page, "per_page": per_page,
        "total_pages": (total as f64 / per_page as f64).ceil() as u64,
    }))
}

#[tauri::command]
pub fn check_is_admin() -> Result<bool, String> {
    let current_os = std::env::consts::OS;
    if current_os == "windows" {
        // Test non destructif via net session pour vérifier l'élévation UAC sous Windows
        let output = std::process::Command::new("net")
            .arg("session")
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .output();
        match output {
            Ok(out) => Ok(out.status.success()),
            Err(_) => Ok(false),
        }
    } else {
        // Unix (macOS / Linux) : UID == 0 pour root
        #[cfg(unix)]
        {
            let uid = unsafe { libc::geteuid() };
            Ok(uid == 0)
        }
        #[cfg(not(unix))]
        {
            Ok(false)
        }
    }
}

#[tauri::command]
pub fn relaunch_as_admin(app: tauri::AppHandle) -> Result<(), String> {
    let current_exe = std::env::current_exe()
        .map_err(|e| format!("Impossible d'obtenir le chemin de l'exécutable: {}", e))?;
    let exe_path = current_exe.to_string_lossy().to_string();

    let current_os = std::env::consts::OS;
    if current_os == "windows" {
        let ps_cmd = format!(
            "Start-Process -FilePath '{}' -Verb RunAs",
            exe_path.replace('\'', "''")
        );
        let _ = std::process::Command::new("powershell")
            .arg("-NoProfile")
            .arg("-NonInteractive")
            .arg("-Command")
            .arg(&ps_cmd)
            .spawn()
            .map_err(|e| format!("Erreur lors de la demande d'élévation UAC: {}", e))?;
        
        // Quitter l'instance non élevée
        app.exit(0);
        Ok(())
    } else if current_os == "macos" || current_os == "darwin" {
        let osa_cmd = format!(
            "do shell script \"open '{}'\" with administrator privileges",
            exe_path
        );
        let _ = std::process::Command::new("osascript")
            .arg("-e")
            .arg(&osa_cmd)
            .spawn()
            .map_err(|e| format!("Erreur élévation macOS: {}", e))?;
        app.exit(0);
        Ok(())
    } else {
        // Linux : pkexec
        let _ = std::process::Command::new("pkexec")
            .arg(&exe_path)
            .spawn()
            .map_err(|e| format!("Erreur pkexec: {}", e))?;
        app.exit(0);
        Ok(())
    }
}

#[tauri::command]
pub fn purge_demo_sources(state: State<'_, AppState>) -> Result<(), String> {
    state.db.purge_demo_sources().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_log_source_priority(
    state: State<'_, AppState>,
    id: String,
    priority: String,
) -> Result<(), String> {
    state.db.update_source_priority(&id, &priority).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_template_translations(
    state: State<'_, AppState>,
) -> Result<Vec<(String, String, String)>, String> {
    state.db.get_all_template_translations().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn save_template_translation(
    state: State<'_, AppState>,
    template_pattern: String,
    french_format: String,
    status_level: String,
) -> Result<(), String> {
    let hash = {
        use sha2::{Digest, Sha256};
        let mut hasher = Sha256::new();
        hasher.update(template_pattern.as_bytes());
        format!("{:x}", hasher.finalize())
    };

    let translation = crate::models::TemplateTranslation {
        template_hash: hash,
        template_pattern: template_pattern.clone(),
        french_format: french_format.clone(),
        status_level: status_level.clone(),
        learned_from: "user_custom".to_string(),
        created_at: chrono::Utc::now(),
    };

    state.db.save_template_translation(&translation).map_err(|e| e.to_string())?;
    state.translator.load_custom_translations(vec![(template_pattern, french_format, status_level)]);
    Ok(())
}

#[tauri::command]
pub fn get_translation_dictionary_rules(
    state: State<'_, AppState>,
) -> Result<Vec<crate::translator::TranslationRule>, String> {
    Ok(state.translator.get_all_rules())
}

#[tauri::command]
pub fn reload_translation_dictionary(
    state: State<'_, AppState>,
) -> Result<usize, String> {
    Ok(state.translator.reload_default_dictionary())
}

#[tauri::command]
pub fn load_custom_translation_file(
    state: State<'_, AppState>,
    file_path: String,
) -> Result<usize, String> {
    let path = std::path::Path::new(&file_path);
    state.translator.load_from_file(path)
}

