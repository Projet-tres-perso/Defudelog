use crate::models::*;
use chrono::Utc;
use tauri::State;

// AppState is in lib.rs - accessed via managed state
type AppState = crate::AppState;

// ─── Helpers ─────────────────────────────────────────

fn parse_source_type(t: &str, config: &serde_json::Value) -> SourceType {
    match t {
        "file_watcher" => SourceType::FileWatcher {
            path: config["path"].as_str().unwrap_or("/var/log").into(),
            pattern: config["pattern"].as_str().unwrap_or("*.log").into(),
        },
        "journald" => SourceType::Journald {
            unit_filter: config["unit_filter"].as_str().map(|s| s.into()),
        },
        "macos_unified_log" => SourceType::MacOsUnifiedLog {
            predicate: config["predicate"].as_str().map(|s| s.into()),
        },
        "windows_event_log" => SourceType::WindowsEventLog {
            channel: config["channel"].as_str().unwrap_or("Security").into(),
            query: config["query"].as_str().map(|s| s.into()),
        },
        "kafka" => SourceType::Kafka {
            topic: config["topic"].as_str().unwrap_or("logs").into(),
            brokers: config["brokers"].as_array()
                .map(|a| a.iter().filter_map(|v| v.as_str().map(String::from)).collect())
                .unwrap_or_default(),
        },
        _ => SourceType::FileWatcher { path: "/var/log".into(), pattern: "*.log".into() },
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
    let source = LogSource {
        id: uuid::Uuid::new_v4().to_string(), name,
        source_type: parse_source_type(&source_type, &config),
        hostname, os, enabled: true, config,
        created_at: Utc::now(), updated_at: Utc::now(),
    };
    state.db.insert_log_source(&source).map_err(|e| e.to_string())?;
    Ok(source)
}

#[tauri::command]
pub fn list_log_sources(state: State<'_, AppState>) -> Result<Vec<LogSource>, String> {
    state.db.get_log_sources().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn toggle_log_source(state: State<'_, AppState>, source_id: String, enabled: bool) -> Result<(), String> {
    state.db.update_source_enabled(&source_id, enabled).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_log_source(state: State<'_, AppState>, source_id: String) -> Result<(), String> {
    state.db.delete_log_source(&source_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn auto_discover_host_sources(_state: State<'_, AppState>) -> Result<Vec<LogSource>, String> {
    let discovered = crate::collector::LogCollector::discover_local_sources();
    // Suggestion mode: return the discovered sources without inserting them automatically.
    Ok(discovered)
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
pub fn get_syslog_status(state: State<'_, AppState>) -> Result<serde_json::Value, String> {
    Ok(serde_json::json!({
        "running": state.syslog_server.is_running(),
        "port": 1514,
        "protocol": "UDP/TCP",
    }))
}

// ─── Log Retrieval ─────────────────────────────────

#[tauri::command]
pub fn get_raw_logs(state: State<'_, AppState>, page: Option<usize>, per_page: Option<usize>,
    search: Option<String>) -> Result<serde_json::Value, String>
{
    let page = page.unwrap_or(1);
    let per_page = per_page.unwrap_or(50);
    let offset = (page - 1) * per_page;
    let (logs, total) = state.db.get_raw_logs(per_page, offset, None, search.as_deref())
        .map_err(|e| e.to_string())?;
    Ok(serde_json::json!({
        "logs": logs, "total": total, "page": page, "per_page": per_page,
        "total_pages": (total as f64 / per_page as f64).ceil() as u64,
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
pub fn update_settings(state: State<'_, AppState>, settings: AppSettings) -> Result<(), String> {
    let mut current = state.settings.lock();
    *current = settings;
    state.db.save_settings(&current).map_err(|e| e.to_string())
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
                source_type: SourceType::FileWatcher { path: "/var/log/demo.log".to_string(), pattern: "*.log".to_string() },
                hostname: hostname.to_string(),
                os: "demo".to_string(),
                enabled: true,
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
