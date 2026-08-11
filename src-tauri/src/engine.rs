#![allow(dead_code)]
use crate::db::Database;
use crate::error::AppError;
use crate::models::*;
use chrono::Utc;
use sha2::{Sha256, Digest};
use std::collections::{HashMap, HashSet, VecDeque};
use std::sync::Arc;

// ============================================================================
// 1. PARSER — Drain-like template miner
// ============================================================================

/// Paramètres de parsing
const PARAM_PATTERNS: &[(&str, &str)] = &[
    (r"\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b", "<IP>"),
    (r"\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b", "<UUID>"),
    (r"\b[0-9a-fA-F]{40,128}\b", "<HASH>"),
    (r"\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}", "<DATETIME>"),
    (r"\b\d{4}-\d{2}-\d{2}\b", "<DATE>"),
    (r"\b\d{2}:\d{2}:\d{2}\b", "<TIME>"),
    (r"\b\d+\b", "<NUM>"),
    (r"(?<=/)[^/\s]+(?:\.[a-zA-Z0-9]+)?(?=\s|$)", "<FILE>"),
];

#[derive(Debug, Clone)]
pub struct LogParser {
    templates: HashMap<String, TemplateInfo>,
    max_templates: usize,
}

#[derive(Debug, Clone)]
struct TemplateInfo {
    id: u64,
    template: String,
    count: u64,
    tokens: Vec<TokenKind>,
}

#[derive(Debug, Clone, PartialEq)]
enum TokenKind {
    Literal(String),
    Param(String), // e.g., "<NUM>", "<IP>"
}

impl LogParser {
    pub fn new(max_templates: usize) -> Self {
        Self {
            templates: HashMap::new(),
            max_templates,
        }
    }

    /// Parse un log brut → template + paramètres
    pub fn parse(&mut self, raw_message: &str) -> ParsedResult {
        let tokens = Self::tokenize(raw_message);
        let template_str = Self::build_template_string(&tokens);
        let cleaned_log = tokens.iter()
            .map(|t| match t {
                TokenKind::Literal(s) => s.clone(),
                TokenKind::Param(p) => p.clone(),
            })
            .collect::<Vec<_>>()
            .join("");

        let template_id = self.get_or_create_template(&template_str);
        let params: Vec<String> = tokens.iter()
            .filter_map(|t| match t {
                TokenKind::Literal(_) => None,
                TokenKind::Param(p) => Some(p.clone()),
            })
            .collect();

        ParsedResult {
            template: template_str,
            template_id,
            parameters: params,
            cleaned_log,
        }
    }

    fn tokenize(message: &str) -> Vec<TokenKind> {
        let mut result: Vec<TokenKind> = vec![];
        let mut remaining = message.to_string();

        while !remaining.is_empty() {
            let mut earliest_match: Option<(usize, usize, &str)> = None;

            for (pattern, replacement) in PARAM_PATTERNS {
                if let Ok(re) = regex::Regex::new(pattern) {
                    if let Some(m) = re.find(&remaining) {
                        if earliest_match.is_none() || m.start() < earliest_match.unwrap().0 {
                            earliest_match = Some((m.start(), m.end(), replacement));
                        }
                    }
                }
            }

            match earliest_match {
                Some((start, end, replacement)) => {
                    if start > 0 {
                        result.push(TokenKind::Literal(remaining[..start].to_string()));
                    }
                    result.push(TokenKind::Param(format!("<{}>", &replacement[1..replacement.len()-1])));
                    remaining = remaining[end..].to_string();
                }
                None => {
                    result.push(TokenKind::Literal(remaining));
                    remaining = String::new();
                }
            }
        }

        // Merge consecutive literals
        let mut merged = Vec::new();
        for token in result {
            if let Some(TokenKind::Literal(last)) = merged.last_mut() {
                if let TokenKind::Literal(curr) = &token {
                    last.push_str(curr);
                    continue;
                }
            }
            merged.push(token);
        }
        merged
    }

    fn build_template_string(tokens: &[TokenKind]) -> String {
        tokens.iter()
            .map(|t| match t {
                TokenKind::Literal(s) => s.clone(),
                TokenKind::Param(p) => p.clone(),
            })
            .collect()
    }

    fn get_or_create_template(&mut self, template: &str) -> u64 {
        if let Some(info) = self.templates.get_mut(template) {
            info.count += 1;
            return info.id;
        }

        if self.templates.len() >= self.max_templates {
            // Remove least used template
            let least = self.templates.iter()
                .min_by_key(|(_, v)| v.count)
                .map(|(k, _)| k.clone());
            if let Some(key) = least {
                self.templates.remove(&key);
            }
        }

        let id = (self.templates.len() + 1) as u64;
        let tokens = Self::tokenize(template);
        self.templates.insert(template.to_string(), TemplateInfo {
            id,
            template: template.to_string(),
            count: 1,
            tokens,
        });
        id
    }

    pub fn template_count(&self) -> usize {
        self.templates.len()
    }
}

#[derive(Debug, Clone)]
pub struct ParsedResult {
    pub template: String,
    pub template_id: u64,
    pub parameters: Vec<String>,
    pub cleaned_log: String,
}

// ============================================================================
// 2. HASHING
// ============================================================================

pub fn hash_log(message: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(message.as_bytes());
    format!("{:x}", hasher.finalize())
}

// ============================================================================
// 3. RULE-BASED DETECTION
// ============================================================================

pub struct RuleEngine {
    keywords: HashSet<String>,
    blacklisted_ips: HashSet<String>,
    blacklisted_users: HashSet<String>,
    regex_rules: Vec<(regex::Regex, String, AlertLevel)>,
}

impl RuleEngine {
    pub fn new(_config: &DetectionSettings) -> Self {
        let mut keywords = HashSet::new();
        keywords.insert("secret_key.pem".to_string());
        keywords.insert("important_file.doc".to_string());
        keywords.insert("/etc/passwd".to_string());
        keywords.insert("/etc/shadow".to_string());
        keywords.insert("confidential".to_string());
        keywords.insert("data_fuite".to_string());
        keywords.insert("sensitive_data".to_string());

        let blacklisted_ips = HashSet::new();
        // These would come from configuration

        let mut blacklisted_users = HashSet::new();
        blacklisted_users.insert("root".to_string());
        blacklisted_users.insert("attacker19".to_string());
        blacklisted_users.insert("cyrus".to_string());

        let regex_rules = vec![
            (
                regex::Regex::new(r"cmd=vi /etc/(passwd|shadow|sudoers)").unwrap(),
                "Modification de fichiers système critiques".to_string(),
                AlertLevel::High,
            ),
            (
                regex::Regex::new(r"scp\s+.*->.*:\S+").unwrap(),
                "Transfert SCP détecté".to_string(),
                AlertLevel::Moderate,
            ),
        ];

        Self {
            keywords,
            blacklisted_ips,
            blacklisted_users,
            regex_rules,
        }
    }

    pub fn evaluate(&self, log_line: &str) -> Vec<(String, AlertLevel)> {
        let mut reasons = Vec::new();
        let lower = log_line.to_lowercase();

        // Keyword detection
        for kw in &self.keywords {
            if lower.contains(kw.as_str()) {
                reasons.push((format!("Mot-clé suspect: {}", kw), AlertLevel::High));
            }
        }

        // IP blacklist
        let ip_re = regex::Regex::new(r"\b(?:\d{1,3}\.){3}\d{1,3}\b").unwrap();
        for cap in ip_re.find_iter(log_line) {
            if self.blacklisted_ips.contains(cap.as_str()) {
                reasons.push((format!("IP blacklistée: {}", cap.as_str()), AlertLevel::High));
            }
        }

        // User blacklist
        let user_re = regex::Regex::new(r"user[\s=]*'?(\S+)'?").unwrap();
        for cap in user_re.captures_iter(log_line) {
            let user = cap.get(1).unwrap().as_str().to_string();
            if self.blacklisted_users.contains(&user) && user != "root" {
                reasons.push((format!("Utilisateur suspect: {}", user), AlertLevel::Moderate));
            }
        }

        // Regex rules
        for (re, desc, severity) in &self.regex_rules {
            if re.is_match(log_line) {
                reasons.push((desc.clone(), severity.clone()));
            }
        }

        reasons
    }
}

// ============================================================================
// 4. TIME CORRELATION
// ============================================================================

pub struct TimeCorrelator {
    window_seconds: u64,
    event_threshold: u64,
    recent_events: HashMap<String, VecDeque<i64>>,
}

impl TimeCorrelator {
    pub fn new(window_seconds: u64, event_threshold: u64) -> Self {
        Self {
            window_seconds,
            event_threshold,
            recent_events: HashMap::new(),
        }
    }

    pub fn check(&mut self, log_line: &str, timestamp: i64) -> Option<String> {
        let pattern = Self::classify_event(log_line);
        let events = self.recent_events.entry(pattern.clone()).or_default();

        // Clean old events
        while let Some(&old) = events.front() {
            if timestamp - old > self.window_seconds as i64 {
                events.pop_front();
            } else {
                break;
            }
        }

        events.push_back(timestamp);

        if events.len() >= self.event_threshold as usize {
            Some(format!(
                "{} événements '{}' en {}s",
                events.len(),
                pattern,
                self.window_seconds
            ))
        } else {
            None
        }
    }

    fn classify_event(log_line: &str) -> String {
        let lower = log_line.to_lowercase();
        if lower.contains("transfer") || lower.contains("scp") { "transfer_event" }
        else if lower.contains("delete") || lower.contains("rm ") { "delete_event" }
        else if lower.contains("login") { "login_event" }
        else if lower.contains("ssh") { "ssh_event" }
        else if lower.contains("failed") { "failed_event" }
        else if lower.contains("alert") { "alert_event" }
        else if lower.contains("sudo") { "sudo_event" }
        else { "generic_event" }.to_string()
    }
}

// ============================================================================
// 5. ANOMALY DETECTION — Simple statistical detector
// ============================================================================

pub struct AnomalyDetector {
    template_frequencies: HashMap<String, Vec<u64>>,
    window_size: usize,
}

impl AnomalyDetector {
    pub fn new(window_size: usize) -> Self {
        Self {
            template_frequencies: HashMap::new(),
            window_size,
        }
    }

    /// Détecte si un template est anormalement fréquent par rapport à l'historique
    pub fn detect(&mut self, template: &str, current_count: u64) -> Option<f64> {
        let freqs = self.template_frequencies
            .entry(template.to_string())
            .or_default();

        if freqs.len() < 5 {
            freqs.push(current_count);
            return None;
        }

        // Calculate z-score
        let mean = freqs.iter().sum::<u64>() as f64 / freqs.len() as f64;
        let variance = freqs.iter()
            .map(|&x| (x as f64 - mean).powi(2))
            .sum::<f64>() / freqs.len() as f64;
        let std_dev = variance.sqrt().max(1.0);

        let z_score = (current_count as f64 - mean) / std_dev;

        // Update window
        freqs.push(current_count);
        if freqs.len() > self.window_size {
            freqs.remove(0);
        }

        if z_score > 2.5 {
            Some((z_score - 2.5).min(1.0)) // Normalize to [0, 1]
        } else {
            None
        }
    }
}

// ============================================================================
// 6. SCORE FUSION
// ============================================================================

pub fn fuse_scores(
    supervised_score: Option<f64>,
    anomaly_score: Option<f64>,
    rule_count: usize,
    time_correlation: bool,
    is_outlier: bool,
) -> (f64, AlertLevel, Vec<String>) {
    let mut reasons = Vec::new();
    let mut total = 0.0f64;
    let mut weights = 0.0f64;

    // Supervised score (weight: 0.35)
    if let Some(s) = supervised_score {
        total += s * 0.35;
        weights += 0.35;
        if s > 0.6 {
            reasons.push(format!("Score supervisé élevé: {:.2}", s));
        }
    }

    // Anomaly score (weight: 0.30)
    if let Some(a) = anomaly_score {
        total += a * 0.30;
        weights += 0.30;
        if a > 0.5 {
            reasons.push(format!("Anomalie détectée: {:.2}", a));
        }
    }

    // Rules (weight: 0.20)
    if rule_count > 0 {
        let rule_contrib = (rule_count as f64 * 0.15).min(1.0);
        total += rule_contrib * 0.20;
        weights += 0.20;
        reasons.push(format!("{} règle(s) déclenchée(s)", rule_count));
    }

    // Time correlation (weight: 0.10)
    if time_correlation {
        total += 1.0 * 0.10;
        weights += 0.10;
        reasons.push("Corrélation temporelle suspecte".to_string());
    }

    // Outlier (weight: 0.05)
    if is_outlier {
        total += 1.0 * 0.05;
        weights += 0.05;
        reasons.push("Log isolé (outlier DBSCAN)".to_string());
    }

    // Normalize
    let final_score = if weights > 0.0 { total / weights } else { 0.0 };

    let level = if final_score >= 0.70 {
        AlertLevel::High
    } else if final_score >= 0.45 {
        AlertLevel::Moderate
    } else if final_score >= 0.25 {
        AlertLevel::Low
    } else {
        AlertLevel::Benign
    };

    (final_score, level, reasons)
}

// ============================================================================
// 7. ORCHESTRATOR — Pipeline complet
// ============================================================================

pub struct DetectionPipeline {
    parser: LogParser,
    rule_engine: RuleEngine,
    time_correlator: TimeCorrelator,
    anomaly_detector: AnomalyDetector,
    db: Arc<Database>,
    settings: DetectionSettings,
    supervised_model: Option<SupervisedModel>,
    active_response: crate::active_response::ActiveResponseEngine,
}

#[derive(Clone)]
pub struct SupervisedModel {
    pub templates: Vec<String>,
    pub weights: Vec<f64>,
    pub threshold: f64,
}

impl SupervisedModel {
    /// Simple TF-IDF-inspired scoring
    pub fn score(&self, template: &str) -> Option<f64> {
        let tokens: HashSet<&str> = template.split_whitespace().collect();
        let mut score = 0.0;
        for (i, known_template) in self.templates.iter().enumerate() {
            let known_tokens: HashSet<&str> = known_template.split_whitespace().collect();
            let intersection = tokens.intersection(&known_tokens).count();
            let union = tokens.union(&known_tokens).count();
            if union > 0 {
                let similarity = intersection as f64 / union as f64;
                score += similarity * self.weights.get(i).copied().unwrap_or(0.0);
            }
        }
        if score > 0.0 {
            Some((score - self.threshold).max(0.0).min(1.0))
        } else {
            None
        }
    }
}

impl DetectionPipeline {
    pub fn new(db: Arc<Database>, settings: DetectionSettings) -> Self {
        let correlator = TimeCorrelator::new(
            settings.time_window_seconds,
            settings.event_threshold,
        );
        let anomaly_detector = AnomalyDetector::new(50);
        let parser = LogParser::new(10000);
        let rule_engine = RuleEngine::new(&settings);

        Self {
            parser,
            rule_engine,
            time_correlator: correlator,
            anomaly_detector,
            db: db.clone(),
            settings,
            supervised_model: None,
            active_response: crate::active_response::ActiveResponseEngine::new(db),
        }
    }

    pub fn set_supervised_model(&mut self, model: SupervisedModel) {
        self.supervised_model = Some(model);
    }

    /// Processus complet d'un log entrant
    pub fn process_log(
        &mut self,
        source_id: &str,
        hostname: &str,
        raw_message: &str,
        timestamp: chrono::DateTime<Utc>,
    ) -> Result<Option<Alert>, AppError> {
        let log_hash = hash_log(raw_message);

        // 1. Insérer le log brut dans la DB
        let raw_log = RawLog {
            id: uuid::Uuid::new_v4().to_string(),
            source_id: source_id.to_string(),
            hostname: hostname.to_string(),
            raw_message: raw_message.to_string(),
            log_hash: log_hash.clone(),
            timestamp,
            ingested_at: Utc::now(),
        };

        self.db.insert_raw_log(&raw_log)?;

        // 2. Parser (Drain-like)
        let parsed = self.parser.parse(raw_message);
        self.db.insert_parsed_log(
            &uuid::Uuid::new_v4().to_string(),
            &raw_log.id,
            raw_message,
            &parsed.template,
            parsed.template_id,
            &serde_json::to_string(&parsed.parameters).unwrap_or_default(),
        )?;

        // 3. Règles
        let rule_matches = self.rule_engine.evaluate(raw_message);
        let _max_rule_severity = rule_matches.iter()
            .map(|(_, l)| l.clone())
            .max_by(|a, b| alert_level_rank(a).cmp(&alert_level_rank(b)));

        // 4. Corrélation temporelle
        let ts_unix = timestamp.timestamp();
        let time_correlation = self.time_correlator.check(raw_message, ts_unix);

        // 5. Détection d'anomalie basée sur la fréquence des templates
        let freq_count = self.db.get_template_count(&parsed.template)?;
        let anomaly_score = self.anomaly_detector.detect(&parsed.template, freq_count);

        // 6. Score supervisé
        let supervised_score = self.supervised_model.as_ref()
            .and_then(|model| model.score(&parsed.template));

        // 7. Fusion
        let (final_score, level, reasons) = fuse_scores(
            supervised_score,
            anomaly_score,
            rule_matches.len(),
            time_correlation.is_some(),
            false, // is_outlier — would come from DBSCAN in real implementation
        );

        // Add rule reasons
        let mut all_reasons: Vec<String> = reasons;
        for (reason, _) in &rule_matches {
            all_reasons.push(reason.clone());
        }
        if let Some(ref tc) = time_correlation {
            all_reasons.push(tc.clone());
        }

        // 8. Créer alerte si nécessaire
        if level != AlertLevel::Benign || !all_reasons.is_empty() {
            let category = categorize_threat(raw_message, &all_reasons);
            let alert = Alert {
                id: uuid::Uuid::new_v4().to_string(),
                raw_log_id: raw_log.id.clone(),
                parsed_log_id: None,
                template: Some(parsed.template),
                category,
                supervised_score,
                anomaly_score,
                cluster_id: None,
                is_outlier: false,
                final_score,
                level: if all_reasons.is_empty() { AlertLevel::Benign } else { level.clone() },
                reasons: all_reasons,
                context_logs: Vec::new(),
                detected_at: Utc::now(),
                acknowledged: false,
                acknowledged_at: None,
            };

            self.db.insert_alert(&alert)?;
            
            // SOAR Trigger
            if alert.level == AlertLevel::High {
                let _ = self.active_response.trigger_response(&alert);
            }
            
            Ok(Some(alert))
        } else {
            Ok(None)
        }
    }

    /// Traitement par lot
    pub fn process_batch(
        &mut self,
        logs: Vec<(String, String, String, chrono::DateTime<Utc>)>,
    ) -> Result<Vec<Alert>, AppError> {
        let mut alerts = Vec::new();
        for (source_id, hostname, raw_message, timestamp) in logs {
            if let Some(alert) = self.process_log(&source_id, &hostname, &raw_message, timestamp)? {
                alerts.push(alert);
            }
        }
        Ok(alerts)
    }

    /// Statistics
    pub fn get_stats(&self) -> Result<DashboardStats, AppError> {
        self.db.get_dashboard_stats()
    }

    pub fn get_alerts(&self, limit: usize, offset: usize) -> Result<Vec<Alert>, AppError> {
        Ok(self.db.get_alerts(None, None, limit, offset)?.0)
    }

    pub fn get_recent_logs(&self, limit: usize) -> Result<Vec<RawLog>, AppError> {
        Ok(self.db.get_raw_logs(limit, 0, None, None)?.0)
    }

    pub fn acknowledge_alert(&self, alert_id: &str) -> Result<(), AppError> {
        self.db.acknowledge_alert(alert_id)
    }

    pub fn get_parser_template_count(&self) -> usize {
        self.parser.template_count()
    }
}

fn alert_level_rank(level: &AlertLevel) -> u8 {
    match level {
        AlertLevel::Benign => 0,
        AlertLevel::Low => 1,
        AlertLevel::Moderate => 2,
        AlertLevel::High => 3,
    }
}

fn categorize_threat(raw_message: &str, reasons: &[String]) -> AlertCategory {
    let text = format!("{} {}", raw_message, reasons.join(" ")).to_lowercase();

    if text.contains("failed password") || text.contains("authentication failure")
        || text.contains("invalid user") || text.contains("ssh")
        || text.contains("login") || text.contains("brute")
        || text.contains("401 unauthorized") || text.contains("access denied") {
        AlertCategory::Authentication
    } else if text.contains("leak") || text.contains("exfiltration")
        || text.contains("export") || text.contains("transfer")
        || text.contains("sensible") || text.contains("secret")
        || text.contains("password") || text.contains("dump") {
        AlertCategory::DataLeak
    } else if text.contains("sudo") || text.contains("root")
        || text.contains("privilege") || text.contains("chmod 777")
        || text.contains("chown") || text.contains("setuid") {
        AlertCategory::PrivilegeEscalation
    } else if text.contains("oom") || text.contains("out of memory")
        || text.contains("500 internal") || text.contains("502 bad gateway")
        || text.contains("504 gateway") || text.contains("exception")
        || text.contains("crash") || text.contains("panic")
        || text.contains("fatal") {
        AlertCategory::SystemAnomaly
    } else {
        AlertCategory::General
    }
}

// ============================================================================
// 8. LOG COLLECTOR INTERFACE (trait only — implementations in collector.rs)
// ============================================================================

/// Common trait for all collectors
pub trait LogCollector: Send {
    fn start(&mut self) -> Result<(), crate::error::AppError>;
    fn stop(&mut self) -> Result<(), crate::error::AppError>;
    fn is_running(&self) -> bool;
    fn name(&self) -> &str;
}
