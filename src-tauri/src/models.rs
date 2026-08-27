#![allow(dead_code)]
use serde::{Deserialize, Serialize};
use chrono::{DateTime, Utc};

/// Catégorie de menace d'une alerte
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum AlertCategory {
    DataLeak,
    Authentication,
    SystemAnomaly,
    PrivilegeEscalation,
    General,
}

impl std::fmt::Display for AlertCategory {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            AlertCategory::DataLeak => write!(f, "data_leak"),
            AlertCategory::Authentication => write!(f, "authentication"),
            AlertCategory::SystemAnomaly => write!(f, "system_anomaly"),
            AlertCategory::PrivilegeEscalation => write!(f, "privilege_escalation"),
            AlertCategory::General => write!(f, "general"),
        }
    }
}

/// Niveau de sévérité d'une alerte
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum AlertLevel {
    Benign,
    Low,
    Moderate,
    High,
}

impl std::fmt::Display for AlertLevel {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            AlertLevel::Benign => write!(f, "benign"),
            AlertLevel::Low => write!(f, "low"),
            AlertLevel::Moderate => write!(f, "moderate"),
            AlertLevel::High => write!(f, "high"),
        }
    }
}

/// Source d'un log
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LogSource {
    pub id: String,
    pub name: String,
    pub source_type: SourceType,
    pub hostname: String,
    pub os: String,
    pub enabled: bool,
    #[serde(default = "default_priority")]
    pub priority: String, // "normal", "high", "critical"
    pub config: serde_json::Value,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

fn default_priority() -> String {
    "normal".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SourceType {
    FileWatcher { path: String, pattern: Option<String> },
    Journald { unit_filter: Option<String> },
    MacOsUnifiedLog { predicate: Option<String> },
    WindowsEventLog { channel: String, query: Option<String> },
    NetworkSyslog { port: u16, protocol: String },
    Kafka { topic: String, brokers: Vec<String> },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum PermissionStatus {
    Accessible,
    PermissionDenied,
    NotFound,
    RequiresElevation,
}

/// Source de log découverte automatiquement avec son état d'accessibilité
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiscoveredSource {
    pub id: String,
    pub name: String,
    pub category: String,
    pub source_type: SourceType,
    pub target_path: String,
    pub hostname: String,
    pub os: String,
    pub status: PermissionStatus,
    pub is_critical_security: bool,
    pub permission_help: Option<String>,
    pub config: serde_json::Value,
}

impl std::fmt::Display for SourceType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            SourceType::FileWatcher { .. } => write!(f, "file_watcher"),
            SourceType::Journald { .. } => write!(f, "journald"),
            SourceType::MacOsUnifiedLog { .. } => write!(f, "macos_unified_log"),
            SourceType::WindowsEventLog { .. } => write!(f, "windows_event_log"),
            SourceType::NetworkSyslog { .. } => write!(f, "network_syslog"),
            SourceType::Kafka { .. } => write!(f, "kafka"),
        }
    }
}

/// Entrée de log brute avec son sens vulgarisé en français
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RawLog {
    pub id: String,
    pub source_id: String,
    pub hostname: String,
    pub raw_message: String,
    pub log_hash: String,
    #[serde(default)]
    pub meaning: Option<String>, // Sens métier court en français
    #[serde(default)]
    pub explanation: Option<String>, // Explication didactique détaillée
    #[serde(default)]
    pub recommendation: Option<String>, // Action recommandée pour l'analyste
    pub timestamp: DateTime<Utc>,
    pub ingested_at: DateTime<Utc>,
}

/// Traduction persistée d'un template de log
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TemplateTranslation {
    pub template_hash: String,
    pub template_pattern: String,
    pub french_format: String,
    #[serde(default)]
    pub explanation: Option<String>,
    #[serde(default)]
    pub recommendation: Option<String>,
    pub status_level: String,
    pub learned_from: String,
    pub created_at: DateTime<Utc>,
}

/// Résultat du parsing Drain-like
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ParsedLog {
    pub id: String,
    pub raw_log_id: String,
    pub raw_message: String,
    pub template: String,
    pub template_id: u64,
    pub parameters: Vec<String>,
    pub parsed_at: DateTime<Utc>,
}

/// Embedding vectoriel d'un log
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LogEmbedding {
    pub id: String,
    pub parsed_log_id: String,
    pub raw_log_id: String,
    pub embedding: Vec<f64>,
    pub dimension: u32,
    pub created_at: DateTime<Utc>,
}

/// Résultat du clustering DBSCAN
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClusterResult {
    pub id: String,
    pub embedding_id: String,
    pub raw_log_id: String,
    pub cluster_id: i32,
    pub is_outlier: bool,
    pub labeled_at: DateTime<Utc>,
}

/// Alerte de détection
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Alert {
    pub id: String,
    pub raw_log_id: String,
    pub parsed_log_id: Option<String>,
    pub template: Option<String>,
    pub category: AlertCategory,
    pub supervised_score: Option<f64>,
    pub anomaly_score: Option<f64>,
    pub cluster_id: Option<i32>,
    pub is_outlier: bool,
    pub final_score: f64,
    pub level: AlertLevel,
    pub reasons: Vec<String>,
    pub context_logs: Vec<String>,
    pub llm_explanation: Option<String>,
    pub mitigation_suggestion: Option<String>,
    pub detected_at: DateTime<Utc>,
    pub acknowledged: bool,
    pub acknowledged_at: Option<DateTime<Utc>>,
}

/// Nœud réseau émetteur de logs
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NetworkNode {
    pub hostname: String,
    pub ip_address: String,
    pub log_count: u64,
    pub last_seen: DateTime<Utc>,
    pub os: String,
}

/// Règle de détection configurable
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DetectionRule {
    pub id: String,
    pub name: String,
    pub description: String,
    pub rule_type: RuleType,
    pub pattern: String,
    pub severity: AlertLevel,
    pub enabled: bool,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RuleType {
    Keyword,
    IpBlacklist,
    UserBlacklist,
    TimeWindow,
    Regex,
    TemplateMatch,
}

/// Statistiques globales
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DashboardStats {
    pub total_logs: u64,
    pub logs_last_24h: u64,
    pub active_sources: u32,
    pub total_templates: u64,
    pub total_alerts: u64,
    pub high_alerts: u64,
    pub moderate_alerts: u64,
    pub alerts_last_24h: u64,
    pub top_templates: Vec<TemplateFrequency>,
    pub alert_trend: Vec<(String, u64)>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TemplateFrequency {
    pub template: String,
    pub count: u64,
    pub alert_count: u64,
}

/// Paramètres de l'application
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppSettings {
    pub db_path: String,
    pub detection: DetectionSettings,
    pub kafka: Option<KafkaSettings>,
    pub llm: Option<LlmSettings>,
    pub webhook_url: Option<String>,
    pub active_response_script: Option<String>,
    pub lan_server: LanServerSettings,
    pub retention: RetentionSettings,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RetentionSettings {
    pub auto_purge_enabled: bool,
    pub retention_days: u32,
    pub archive_before_purge: bool,
    pub archive_directory: String,
}

impl Default for RetentionSettings {
    fn default() -> Self {
        Self {
            auto_purge_enabled: false,
            retention_days: 30,
            archive_before_purge: true,
            archive_directory: "archives".to_string(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PurgeResult {
    pub purged_logs: u64,
    pub purged_alerts: u64,
    pub archive_file: Option<String>,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LanServerSettings {
    pub enabled: bool,
    pub port: u16,
    pub admin_username: String,
    pub admin_access_key: String, // 7 caractères
    pub user_username: String,
    pub user_access_key: String,  // 7 caractères
    pub user_allowed_views: Vec<String>, // ["dashboard", "logs", "alerts", "rules", "network"]
}

impl Default for LanServerSettings {
    fn default() -> Self {
        Self {
            enabled: false,
            port: 8080,
            admin_username: "admin_soc".to_string(),
            admin_access_key: "DF7K9QX".to_string(),
            user_username: "analyste".to_string(),
            user_access_key: "US4M2P8".to_string(),
            user_allowed_views: vec![
                "dashboard".to_string(),
                "logs".to_string(),
                "alerts".to_string(),
            ],
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DetectionSettings {
    pub batch_size: usize,
    pub anomaly_threshold: f64,
    pub supervised_threshold: f64,
    pub dbscan_eps: f64,
    pub dbscan_min_samples: usize,
    pub time_window_seconds: u64,
    pub event_threshold: u64,
    pub auto_train: bool,
    pub training_interval_hours: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KafkaSettings {
    pub brokers: Vec<String>,
    pub input_topic: String,
    pub output_topic: String,
    pub group_id: String,
    pub sasl_username: Option<String>,
    pub sasl_password: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LlmSettings {
    pub base_url: String,
    pub api_key: String,
    pub model: String,
    pub enabled: bool,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            db_path: "defudelog.db".to_string(),
            detection: DetectionSettings {
                batch_size: 500,
                anomaly_threshold: 0.3,
                supervised_threshold: 0.6,
                dbscan_eps: 0.5,
                dbscan_min_samples: 5,
                time_window_seconds: 60,
                event_threshold: 10,
                auto_train: false,
                training_interval_hours: 24,
            },
            kafka: None,
            llm: None,
            webhook_url: None,
            lan_server: LanServerSettings::default(),
            retention: RetentionSettings::default(),
            active_response_script: Some(
"#!/bin/sh
# Script de remédiation SOAR (Active Response)
# Paramètres reçus : $1=ALERT_ID, $2=CATEGORY
echo \"[$(date)] Mitigation déclenchée pour l'alerte $1 ($2)\" >> /tmp/defudelog_soar.log
# Exemple : bloquer une IP avec iptables
# iptables -A INPUT -s $3 -j DROP
".to_string()
            ),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TimeSeriesPoint {
    pub time: String, // HH:00 format
    pub logs: u64,
    pub alerts: u64,
}
