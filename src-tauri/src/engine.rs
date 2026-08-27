#![allow(dead_code)]
use crate::db::Database;
use crate::error::AppError;
use crate::models::*;
use chrono::Utc;
use sha2::{Sha256, Digest};
use std::collections::{HashMap, HashSet, VecDeque};
use std::sync::{Arc, LazyLock};
use fastembed::{TextEmbedding, InitOptions, EmbeddingModel};

// ============================================================================
// 1. REGEX PRE-COMPILATION (Performance & Zero Allocation in Hot Path)
// ============================================================================

struct CompiledPattern {
    regex: regex::Regex,
    replacement: &'static str,
}

static PARAM_PATTERNS: LazyLock<Vec<CompiledPattern>> = LazyLock::new(|| {
    vec![
        CompiledPattern { regex: regex::Regex::new(r"\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b").unwrap(), replacement: "<IP>" },
        CompiledPattern { regex: regex::Regex::new(r"\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b").unwrap(), replacement: "<UUID>" },
        CompiledPattern { regex: regex::Regex::new(r"\b[0-9a-fA-F]{40,128}\b").unwrap(), replacement: "<HASH>" },
        CompiledPattern { regex: regex::Regex::new(r"\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?").unwrap(), replacement: "<DATETIME>" },
        CompiledPattern { regex: regex::Regex::new(r"\b\d{4}-\d{2}-\d{2}\b").unwrap(), replacement: "<DATE>" },
        CompiledPattern { regex: regex::Regex::new(r"\b\d{2}:\d{2}:\d{2}\b").unwrap(), replacement: "<TIME>" },
        CompiledPattern { regex: regex::Regex::new(r"\b\d+\b").unwrap(), replacement: "<NUM>" },
        CompiledPattern { regex: regex::Regex::new(r"/[a-zA-Z0-9_\.\-]+(?:/[a-zA-Z0-9_\.\-]+)*").unwrap(), replacement: "<PATH>" },
    ]
});

static DLP_SIGNATURES: LazyLock<Vec<(regex::Regex, &'static str, AlertLevel)>> = LazyLock::new(|| {
    vec![
        (
            regex::Regex::new(r"(?i)(?:-----)?BEGIN\s+(?:RSA\s+)?PRIVATE\s+KEY(?:-----)?").unwrap(),
            "Clé privée RSA / SSH exposée dans les logs",
            AlertLevel::High,
        ),
        (
            regex::Regex::new(r"(?i)(?:credit_card|credit[_\s-]?cards|\b(?:4[0-9]{12}(?:[0-9]{3})?|5[1-5][0-9]{14}|3[47][0-9]{13})\b)").unwrap(),
            "Numéros de carte bancaire ou données de paiement exposées",
            AlertLevel::High,
        ),
        (
            regex::Regex::new(r"(?i)(?:api[_-]?key|access[_-]?token|bearer\s+[a-z0-9_\-\.]{20,})").unwrap(),
            "Token API ou secret d'accès exposé",
            AlertLevel::High,
        ),
        (
            regex::Regex::new(r"(?i)(?:password|passwd|pwd)\s*[=:]\s*['\x22]?\S{4,}").unwrap(),
            "Mot de passe en clair détecté",
            AlertLevel::High,
        ),
        (
            regex::Regex::new(r"(?i)(?:exfiltration|data_leak|dump\.csv|customer_records|database_dump)").unwrap(),
            "Indicateur explicite d'exfiltration ou de fuite de données",
            AlertLevel::High,
        ),
        (
            regex::Regex::new(r"(?i)cmd=vi\s+/etc/(?:passwd|shadow|sudoers)").unwrap(),
            "Tentative de modification directe des fichiers d'authentification système",
            AlertLevel::High,
        ),
        (
            regex::Regex::new(r"(?i)(?:chmod\s+777|chown\s+root)\s+/etc/").unwrap(),
            "Élévation de privilèges ou altération de permissions critiques",
            AlertLevel::High,
        ),
        (
            regex::Regex::new(r"(?i)(?:out of memory|kernel panic|fatal error|segmentation fault|segfault)").unwrap(),
            "Crash critique ou panne système",
            AlertLevel::Moderate,
        ),
        (
            regex::Regex::new(r"(?i)(?:curl|wget)\s+.*\|\s*(?:sh|bash|zsh)").unwrap(),
            "Exécution suspecte de script distant via pipe (Remote Code Execution)",
            AlertLevel::High,
        ),
    ]
});

// ============================================================================
// 2. DRAIN-LIKE LOG PARSER (Structure Mining & Template Catalog)
// ============================================================================

#[derive(Debug, Clone, PartialEq)]
pub enum TemplateClass {
    CriticalThreat,
    WarningAnomaly,
    StandardOperational,
}

#[derive(Debug, Clone)]
pub struct TemplateInfo {
    pub id: u64,
    pub template: String,
    pub count: u64,
    pub classification: TemplateClass,
    pub is_new: bool,
}

#[derive(Debug, Clone)]
pub struct ParsedResult {
    pub template: String,
    pub template_id: u64,
    pub parameters: Vec<String>,
    pub cleaned_log: String,
    pub classification: TemplateClass,
    pub is_new: bool,
}

#[derive(Debug, Clone)]
pub struct LogParser {
    templates: HashMap<String, TemplateInfo>,
    max_templates: usize,
}

impl LogParser {
    pub fn new(max_templates: usize) -> Self {
        Self {
            templates: HashMap::new(),
            max_templates,
        }
    }

    /// Extrait la structure abstraite (template) du log brut
    pub fn parse(&mut self, raw_message: &str) -> ParsedResult {
        let tokens = Self::tokenize(raw_message);
        let template_str = Self::build_template_string(&tokens);
        let cleaned_log = template_str.clone();

        let params: Vec<String> = tokens.iter()
            .filter_map(|t| match t {
                TokenKind::Literal(_) => None,
                TokenKind::Param { raw_value, .. } => Some(raw_value.clone()),
            })
            .collect();

        let (template_id, classification, is_new) = self.get_or_register_template(&template_str);

        ParsedResult {
            template: template_str,
            template_id,
            parameters: params,
            cleaned_log,
            classification,
            is_new,
        }
    }

    fn tokenize(message: &str) -> Vec<TokenKind> {
        let mut result: Vec<TokenKind> = vec![];
        let mut remaining = message.to_string();

        while !remaining.is_empty() {
            let mut earliest_match: Option<(usize, usize, &str)> = None;

            for pat in PARAM_PATTERNS.iter() {
                if let Some(m) = pat.regex.find(&remaining) {
                    if earliest_match.is_none() || m.start() < earliest_match.unwrap().0 {
                        earliest_match = Some((m.start(), m.end(), pat.replacement));
                    }
                }
            }

            match earliest_match {
                Some((start, end, replacement)) => {
                    if start > 0 {
                        result.push(TokenKind::Literal(remaining[..start].to_string()));
                    }
                    let raw_val = remaining[start..end].to_string();
                    result.push(TokenKind::Param {
                        placeholder: replacement.to_string(),
                        raw_value: raw_val,
                    });
                    remaining = remaining[end..].to_string();
                }
                None => {
                    result.push(TokenKind::Literal(remaining));
                    remaining = String::new();
                }
            }
        }

        // Fusionner les littéraux consécutifs
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
                TokenKind::Literal(s) => s.as_str(),
                TokenKind::Param { placeholder, .. } => placeholder.as_str(),
            })
            .collect::<Vec<_>>()
            .join("")
    }

    fn get_or_register_template(&mut self, template: &str) -> (u64, TemplateClass, bool) {
        if let Some(info) = self.templates.get_mut(template) {
            info.count += 1;
            return (info.id, info.classification.clone(), false);
        }

        // Éviction LRU si saturation
        if self.templates.len() >= self.max_templates {
            let least = self.templates.iter()
                .min_by_key(|(_, v)| v.count)
                .map(|(k, _)| k.clone());
            if let Some(key) = least {
                self.templates.remove(&key);
            }
        }

        let id = (self.templates.len() + 1) as u64;
        let classification = Self::classify_template_content(template);
        
        self.templates.insert(template.to_string(), TemplateInfo {
            id,
            template: template.to_string(),
            count: 1,
            classification: classification.clone(),
            is_new: true,
        });

        (id, classification, true)
    }

    /// Classification structurelle des templates
    fn classify_template_content(template: &str) -> TemplateClass {
        let t = template.to_lowercase();
        if t.contains("exfiltration") || t.contains("data_leak") || t.contains("dump.csv")
            || t.contains("customer records") || t.contains("export <NUM>")
            || (t.contains("sudo") && (t.contains("chmod 777") || t.contains("/bin/bash") || t.contains("/etc/shadow")))
        {
            TemplateClass::CriticalThreat
        } else if t.contains("failed password") || t.contains("authentication failure")
            || t.contains("out of memory") || t.contains("status=500")
            || t.contains("segfault") || t.contains("panic") || t.contains("denied")
        {
            TemplateClass::WarningAnomaly
        } else {
            TemplateClass::StandardOperational
        }
    }

    pub fn template_count(&self) -> usize {
        self.templates.len()
    }
}

#[derive(Debug, Clone, PartialEq)]
enum TokenKind {
    Literal(String),
    Param {
        placeholder: String,
        raw_value: String,
    },
}

// ============================================================================
// 3. HASHING
// ============================================================================

pub fn hash_log(message: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(message.as_bytes());
    format!("{:x}", hasher.finalize())
}

// ============================================================================
// 4. DETERMINISTIC DLP & SIGNATURE ENGINE (Sur Raw Logs & Règles DB)
// ============================================================================

pub struct RuleEngine {
    db: Arc<Database>,
    blacklisted_ips: HashSet<String>,
    blacklisted_users: HashSet<String>,
}

impl RuleEngine {
    pub fn new(db: Arc<Database>, _config: &DetectionSettings) -> Self {
        let mut blacklisted_ips = HashSet::new();
        blacklisted_ips.insert("185.220.101.5".to_string());
        blacklisted_ips.insert("192.168.1.42".to_string());
        blacklisted_ips.insert("10.0.0.99".to_string());

        let mut blacklisted_users = HashSet::new();
        blacklisted_users.insert("attacker19".to_string());
        blacklisted_users.insert("cyrus".to_string());

        Self {
            db,
            blacklisted_ips,
            blacklisted_users,
        }
    }

    /// Évalue un log brut contre les signatures DLP et les règles dynamiques actives en DB
    pub fn evaluate(&self, raw_message: &str) -> Vec<(String, AlertLevel)> {
        let mut matches = Vec::new();
        let lower = raw_message.to_lowercase();

        // 1. Signatures DLP pré-compilées
        for (re, desc, severity) in DLP_SIGNATURES.iter() {
            if re.is_match(raw_message) {
                matches.push((desc.to_string(), severity.clone()));
            }
        }

        // 2. IP Blacklists
        for ip in &self.blacklisted_ips {
            if raw_message.contains(ip) {
                matches.push((format!("Connexion/Transfert avec IP suspecte blacklistée: {}", ip), AlertLevel::High));
            }
        }

        // 3. User Blacklists
        for user in &self.blacklisted_users {
            if lower.contains(&format!("user {}", user)) || lower.contains(&format!("user={}", user)) || lower.contains(&format!("sudo: {}", user)) {
                matches.push((format!("Activité liée à un utilisateur surveillé / compromis: {}", user), AlertLevel::Moderate));
            }
        }

        // 4. Règles dynamiques configurées par l'utilisateur depuis la base de données
        if let Ok(rules) = self.db.get_rules() {
            for rule in rules.into_iter().filter(|r| r.enabled) {
                match rule.rule_type {
                    RuleType::Keyword => {
                        let kws: Vec<&str> = rule.pattern.split('|').collect();
                        for kw in kws {
                            if !kw.trim().is_empty() && lower.contains(&kw.trim().to_lowercase()) {
                                matches.push((format!("Règle '{}' déclenchée (mot-clé '{}')", rule.name, kw.trim()), rule.severity.clone()));
                                break;
                            }
                        }
                    }
                    RuleType::IpBlacklist => {
                        let ips: Vec<&str> = rule.pattern.split('|').collect();
                        for ip in ips {
                            if !ip.trim().is_empty() && raw_message.contains(ip.trim()) {
                                matches.push((format!("Règle '{}' déclenchée (IP '{}')", rule.name, ip.trim()), rule.severity.clone()));
                                break;
                            }
                        }
                    }
                    RuleType::UserBlacklist => {
                        let users: Vec<&str> = rule.pattern.split('|').collect();
                        for u in users {
                            if !u.trim().is_empty() && lower.contains(&u.trim().to_lowercase()) {
                                matches.push((format!("Règle '{}' déclenchée (Utilisateur '{}')", rule.name, u.trim()), rule.severity.clone()));
                                break;
                            }
                        }
                    }
                    RuleType::Regex => {
                        if let Ok(re) = regex::Regex::new(&rule.pattern) {
                            if re.is_match(raw_message) {
                                matches.push((format!("Règle Regex '{}' déclenchée", rule.name), rule.severity.clone()));
                            }
                        }
                    }
                    RuleType::TemplateMatch
                        if lower.contains(&rule.pattern.to_lowercase()) => {
                            matches.push((format!("Règle Template '{}' déclenchée", rule.name), rule.severity.clone()));
                        }
                    _ => {}
                }
            }
        }

        matches
    }
}

// ============================================================================
// 5. SEMANTIC THREAT PROFILER (BGE Embeddings & Cosine Similarity)
// ============================================================================

struct ThreatProfile {
    category: AlertCategory,
    description: &'static str,
    reference_text: &'static str,
    embedding: Option<Vec<f64>>,
}

pub struct SemanticThreatMatcher {
    model: Arc<parking_lot::Mutex<Option<TextEmbedding>>>,
    threat_profiles: parking_lot::Mutex<Vec<ThreatProfile>>,
}

impl SemanticThreatMatcher {
    pub fn new(model: Arc<parking_lot::Mutex<Option<TextEmbedding>>>) -> Self {
        let profiles = vec![
            ThreatProfile {
                category: AlertCategory::DataLeak,
                description: "Exfiltration et fuite de données massives",
                reference_text: "Data exfiltration, unauthorized file transfer to external cloud storage bucket, customer database leak, credentials dump",
                embedding: None,
            },
            ThreatProfile {
                category: AlertCategory::PrivilegeEscalation,
                description: "Élévation de privilèges et altération des droits",
                reference_text: "Privilege escalation, unauthorized root access, changing sudoers and shadow file permissions, executing root shell",
                embedding: None,
            },
            ThreatProfile {
                category: AlertCategory::Authentication,
                description: "Attaque par force brute et pulvérisation de mots de passe",
                reference_text: "Brute force authentication attack, multiple failed password attempts, PAM authorization failure on SSH",
                embedding: None,
            },
            ThreatProfile {
                category: AlertCategory::SystemAnomaly,
                description: "Défaillance critique système et crash d'application",
                reference_text: "Out of memory crash, fatal process kill, kernel panic, HTTP 500 internal server error collapse",
                embedding: None,
            },
        ];

        Self {
            model,
            threat_profiles: parking_lot::Mutex::new(profiles),
        }
    }

    /// Pré-calcule les embeddings des profils de menaces de référence dès que le modèle BGE est disponible
    pub fn init_reference_embeddings(&self) {
        if let Some(ref mut model) = *self.model.lock() {
            let mut profiles = self.threat_profiles.lock();
            for profile in profiles.iter_mut() {
                if profile.embedding.is_none() {
                    if let Ok(mut embs) = model.embed(vec![profile.reference_text.to_string()], None) {
                        if let Some(vec_f32) = embs.pop() {
                            profile.embedding = Some(vec_f32.into_iter().map(|v| v as f64).collect());
                        }
                    }
                }
            }
        }
    }

    /// Évalue la similarité sémantique d'un log avec les profils de cyber-menaces
    pub fn match_threat(&self, log_embedding: &[f64]) -> Option<(f64, AlertCategory, &'static str)> {
        let profiles = self.threat_profiles.lock();
        let mut best_match: Option<(f64, AlertCategory, &'static str)> = None;

        for profile in profiles.iter() {
            if let Some(ref ref_emb) = profile.embedding {
                let similarity = cosine_similarity(log_embedding, ref_emb);
                if similarity > 0.60
                    && (best_match.is_none() || similarity > best_match.as_ref().unwrap().0) {
                    best_match = Some((similarity, profile.category.clone(), profile.description));
                }
            }
        }

        best_match
    }
}

fn cosine_similarity(a: &[f64], b: &[f64]) -> f64 {
    if a.len() != b.len() || a.is_empty() {
        return 0.0;
    }
    let dot: f64 = a.iter().zip(b.iter()).map(|(x, y)| x * y).sum();
    let norm_a: f64 = a.iter().map(|x| x * x).sum::<f64>().sqrt();
    let norm_b: f64 = b.iter().map(|x| x * x).sum::<f64>().sqrt();
    if norm_a == 0.0 || norm_b == 0.0 {
        0.0
    } else {
        (dot / (norm_a * norm_b)).clamp(0.0, 1.0)
    }
}

// ============================================================================
// 6. TIME CORRELATION & BURST DETECTOR
// ============================================================================

pub struct TimeCorrelator {
    event_threshold: u64,
    recent_events: HashMap<String, VecDeque<i64>>,
}

impl TimeCorrelator {
    pub fn new(_window_seconds: u64, event_threshold: u64) -> Self {
        Self {
            event_threshold,
            recent_events: HashMap::new(),
        }
    }

    pub fn check_exponential_decay(&mut self, log_line: &str, timestamp: i64) -> Option<(f64, String)> {
        let pattern = Self::classify_event(log_line);
        let events = self.recent_events.entry(pattern.clone()).or_default();

        let mut decay_score = 0.0;
        let lambda = 0.05; // Constante de décroissance exponentielle

        for &old_ts in events.iter() {
            let dt = (timestamp - old_ts).max(0) as f64;
            decay_score += (-lambda * dt).exp();
        }

        // Nettoyer les événements de plus de 5 minutes
        while let Some(&old) = events.front() {
            if (timestamp - old) > 300 {
                events.pop_front();
            } else {
                break;
            }
        }

        events.push_back(timestamp);

        if decay_score >= (self.event_threshold as f64 * 0.4) {
            Some((
                decay_score,
                format!("Rafale d'événements corrélés (Score temporel: {:.2}) sur '{}'", decay_score, pattern)
            ))
        } else {
            None
        }
    }

    fn classify_event(log_line: &str) -> String {
        let lower = log_line.to_lowercase();
        if lower.contains("transfer") || lower.contains("scp") || lower.contains("curl") || lower.contains("dump") {
            "data_transfer_burst".to_string()
        } else if lower.contains("failed") || lower.contains("invalid user") || lower.contains("ssh") {
            "auth_failure_burst".to_string()
        } else if lower.contains("sudo") || lower.contains("chmod") || lower.contains("chown") {
            "privilege_escalation_burst".to_string()
        } else {
            "operational_event".to_string()
        }
    }
}

// ============================================================================
// 7. CONTEXTUAL LLM ANALYZER (SOC Tier-2 Automated Reasoning)
// ============================================================================

pub struct ContextualLlmAnalyzer;

#[derive(serde::Deserialize)]
struct LlmEvaluationResponse {
    is_threat: bool,
    confidence: f64,
    explanation: String,
    mitigation: Option<String>,
}

impl ContextualLlmAnalyzer {
    /// Analyse contextuelle avec logs voisins via l'API LLM configurée
    pub async fn analyze_incident(
        settings: &LlmSettings,
        target_log: &RawLog,
        reasons: &[String],
        neighbor_logs: &[RawLog],
    ) -> Option<(String, String, bool)> {
        if !settings.enabled || settings.base_url.trim().is_empty() {
            return None;
        }

        let neighbors_text: Vec<String> = neighbor_logs.iter().map(|l| {
            format!("[{}] (Host: {}) {}", l.timestamp.format("%H:%M:%S"), l.hostname, l.raw_message)
        }).collect();

        let system_prompt = "Tu es un analyste expert en cybersécurité et détection de fuites de données (SOC Tier-2/Tier-3). \
        Ton rôle est d'analyser un log suspect en tenant compte de sa chronologie et de ses logs voisins. \
        Tu dois répondre STRICTEMENT au format JSON avec les champs suivants : \
        {\
          \"is_threat\": true/false,\
          \"confidence\": 0.0 à 1.0,\
          \"explanation\": \"Explication claire et synthétique en français de l'incident et de ce qui s'est réellement passé\",\
          \"mitigation\": \"Action corrective immédiate recommandée (ex: isoler l'hôte, bloquer l'IP, révoquer la clé)\"\
        }";

        let neighbors_joined = if neighbors_text.is_empty() {
            "(Aucun log voisin)".to_string()
        } else {
            neighbors_text.join("\n")
        };

        let reasons_joined = reasons.join("\n- ");

        let user_prompt = format!(
            "LOG SUSPECT CIBLÉ :\n[Host: {}] [Heure: {}] {}\n\n\
            SIGNAUX DÉTECTÉS PAR LE MOTEUR :\n{}\n\n\
            CONTEXTE CHRONOLOGIQUE (LOGS VOISINS) :\n{}\n\n\
            Fournis ton verdict SOC d'investigation au format JSON demandé.",
            target_log.hostname,
            target_log.timestamp.to_rfc3339(),
            target_log.raw_message,
            reasons_joined,
            neighbors_joined,
        );

        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(6))
            .build()
            .ok()?;

        let api_url = format!("{}/chat/completions", settings.base_url.trim_end_matches('/'));
        let request_body = serde_json::json!({
            "model": if settings.model.is_empty() { "llama3" } else { &settings.model },
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt}
            ],
            "temperature": 0.1,
            "response_format": {"type": "json_object"}
        });

        let mut req = client.post(&api_url).json(&request_body);
        if !settings.api_key.trim().is_empty() {
            req = req.header("Authorization", format!("Bearer {}", settings.api_key));
        }

        if let Ok(res) = req.send().await {
            if res.status().is_success() {
                if let Ok(json) = res.json::<serde_json::Value>().await {
                    if let Some(content) = json["choices"][0]["message"]["content"].as_str() {
                        if let Ok(parsed) = serde_json::from_str::<LlmEvaluationResponse>(content) {
                            return Some((
                                parsed.explanation,
                                parsed.mitigation.unwrap_or_else(|| "Surveiller les activités de l'utilisateur et isoler la machine en cas de récidive.".to_string()),
                                parsed.is_threat
                            ));
                        }
                    }
                }
            }
        }

        None
    }
}

// ============================================================================
// 8. UNIFIED DETECTION PIPELINE
// ============================================================================

pub struct DetectionPipeline {
    parser: LogParser,
    rule_engine: RuleEngine,
    time_correlator: TimeCorrelator,
    semantic_matcher: SemanticThreatMatcher,
    db: Arc<Database>,
    settings: DetectionSettings,
    app_settings: Arc<parking_lot::Mutex<AppSettings>>,
    active_response: crate::active_response::ActiveResponseEngine,
    text_embedding_model: Arc<parking_lot::Mutex<Option<TextEmbedding>>>,
    recent_embeddings: VecDeque<(String, Vec<f64>)>,
}

impl DetectionPipeline {
    pub fn new(db: Arc<Database>, settings: DetectionSettings, app_handle: tauri::AppHandle) -> Self {
        let correlator = TimeCorrelator::new(
            settings.time_window_seconds,
            settings.event_threshold,
        );
        let parser = LogParser::new(10000);
        let rule_engine = RuleEngine::new(db.clone(), &settings);
        
        let text_embedding_model = Arc::new(parking_lot::Mutex::new(None));
        let semantic_matcher = SemanticThreatMatcher::new(text_embedding_model.clone());

        let model_clone = text_embedding_model.clone();
        let app_handle_clone = app_handle.clone();
        
        std::thread::spawn(move || {
            use tauri::Emitter;
            let _ = app_handle_clone.emit("ml-loading", ());
            
            match TextEmbedding::try_new(InitOptions::new(EmbeddingModel::BGESmallENV15)) {
                Ok(model) => {
                    *model_clone.lock() = Some(model);
                    let _ = app_handle_clone.emit("ml-ready", ());
                }
                Err(e) => {
                    log::warn!("Impossible de charger le modèle d'embedding BGE: {}", e);
                    let _ = app_handle_clone.emit("ml-error", e.to_string());
                }
            }
        });

        let app_settings = Arc::new(parking_lot::Mutex::new(db.get_settings().unwrap_or_default()));

        Self {
            parser,
            rule_engine,
            time_correlator: correlator,
            semantic_matcher,
            db: db.clone(),
            settings,
            app_settings,
            active_response: crate::active_response::ActiveResponseEngine::new(db),
            text_embedding_model,
            recent_embeddings: VecDeque::with_capacity(100),
        }
    }

    /// Constructeur autonome pour les tests et exécutions headless (sans fenêtre Tauri active)
    pub fn new_headless(db: Arc<Database>, settings: DetectionSettings) -> Self {
        let correlator = TimeCorrelator::new(
            settings.time_window_seconds,
            settings.event_threshold,
        );
        let parser = LogParser::new(10000);
        let rule_engine = RuleEngine::new(db.clone(), &settings);
        
        let text_embedding_model = Arc::new(parking_lot::Mutex::new(None));
        let semantic_matcher = SemanticThreatMatcher::new(text_embedding_model.clone());

        // Chargement synchrone / direct du modèle pour le test si disponible
        let model_clone = text_embedding_model.clone();
        std::thread::spawn(move || {
            if let Ok(model) = TextEmbedding::try_new(InitOptions::new(EmbeddingModel::BGESmallENV15)) {
                *model_clone.lock() = Some(model);
            }
        });

        let app_settings = Arc::new(parking_lot::Mutex::new(db.get_settings().unwrap_or_default()));

        Self {
            parser,
            rule_engine,
            time_correlator: correlator,
            semantic_matcher,
            db: db.clone(),
            settings,
            app_settings,
            active_response: crate::active_response::ActiveResponseEngine::new(db),
            text_embedding_model,
            recent_embeddings: VecDeque::with_capacity(100),
        }
    }

    /// Analyse la structure Drain du log sans déclencher tout le pipeline d'alerte
    pub fn parse_log_structure(&mut self, raw_message: &str) -> ParsedResult {
        self.parser.parse(raw_message)
    }

    /// Processus complet de détection multi-axes sur chaque log entrant
    pub fn process_log(
        &mut self,
        source_id: &str,
        hostname: &str,
        raw_message: &str,
        timestamp: chrono::DateTime<Utc>,
    ) -> Result<Option<Alert>, AppError> {
        let log_hash = hash_log(raw_message);

        // 1. Persister le log brut dans la base SQLCipher
        let raw_log = RawLog {
            id: uuid::Uuid::new_v4().to_string(),
            source_id: source_id.to_string(),
            hostname: hostname.to_string(),
            raw_message: raw_message.to_string(),
            log_hash: log_hash.clone(),
            meaning: None,
            explanation: None,
            recommendation: None,
            timestamp,
            ingested_at: Utc::now(),
        };

        self.db.insert_raw_log(&raw_log)?;

        // 2. AXE STRUCTUREL : Mining de template Drain & Détection de template critique/inédit
        let parsed = self.parser.parse(raw_message);
        self.db.insert_parsed_log(
            &uuid::Uuid::new_v4().to_string(),
            &raw_log.id,
            raw_message,
            &parsed.template,
            parsed.template_id,
            &serde_json::to_string(&parsed.parameters).unwrap_or_default(),
        )?;

        let mut reasons = Vec::new();
        let mut dlp_score = 0.0f64;
        let mut template_score = 0.0f64;
        let mut semantic_score = 0.0f64;
        let mut time_score = 0.0f64;
        let mut is_critical_hit = false;

        // Évaluation Drain
        match parsed.classification {
            TemplateClass::CriticalThreat => {
                template_score = 0.90;
                is_critical_hit = true;
                reasons.push(format!("Template critique correspondant à un motif de fuite/attaque: '{}'", parsed.template));
            }
            TemplateClass::WarningAnomaly => {
                template_score = 0.50;
                reasons.push(format!("Template d'avertissement système: '{}'", parsed.template));
            }
            TemplateClass::StandardOperational => {
                if parsed.is_new {
                    template_score = 0.20;
                    reasons.push("Template inédit observé pour la première fois (Zero-Day structural)".to_string());
                }
            }
        }

        // 3. AXE DÉTERMINISTE DLP : Inspection directe des Raw Logs & Règles DB
        let rule_matches = self.rule_engine.evaluate(raw_message);
        if !rule_matches.is_empty() {
            dlp_score = (rule_matches.len() as f64 * 0.40).min(1.0);
            for (reason, severity) in &rule_matches {
                if *severity == AlertLevel::High {
                    is_critical_hit = true;
                    dlp_score = 1.0;
                } else if *severity == AlertLevel::Moderate {
                    dlp_score = dlp_score.max(0.85);
                }
                reasons.push(reason.clone());
            }
        }

        // 4. AXE TEMPOREL : Exponential decay sur rafales d'événements
        if let Some((score, reason)) = self.time_correlator.check_exponential_decay(&parsed.template, timestamp.timestamp()) {
            time_score = (score / 10.0).min(1.0);
            reasons.push(reason);
        }

        // 5. AXE SÉMANTIQUE & CLUSTERING HDBSCAN : Embedding vectoriel BGE (ONNX) + HDBSCAN Outlier
        self.semantic_matcher.init_reference_embeddings();
        let mut is_outlier = false;
        let mut outlier_score = 0.0f64;

        if let Some(ref mut model) = *self.text_embedding_model.lock() {
            if let Ok(mut embeddings) = model.embed(vec![raw_message.to_string()], None) {
                if let Some(vec_f32) = embeddings.pop() {
                    let vec_f64: Vec<f64> = vec_f32.iter().map(|v| *v as f64).collect();
                    
                    // A. Similarité sémantique cosinus avec menaces de référence
                    if let Some((similarity, _cat, threat_desc)) = self.semantic_matcher.match_threat(&vec_f64) {
                        semantic_score = similarity;
                        if similarity >= 0.70 {
                            reasons.push(format!("Forte similarité sémantique ({:.0}%) avec: {}", similarity * 100.0, threat_desc));
                        }
                    }

                    // B. Clustering non supervisé HDBSCAN sur fenêtre glissante (60 derniers logs)
                    self.recent_embeddings.push_back((raw_log.id.clone(), vec_f64.clone()));
                    if self.recent_embeddings.len() > 60 {
                        self.recent_embeddings.pop_front();
                    }

                    if self.recent_embeddings.len() >= 15 {
                        let data: Vec<Vec<f32>> = self.recent_embeddings.iter()
                            .map(|(_, v)| v.iter().map(|f| *f as f32).collect())
                            .collect();

                        if let Ok(clusterer) = hdbscan::Hdbscan::default_hyper_params(&data).cluster() {
                            if let Some(last_label) = clusterer.last() {
                                if *last_label == -1 {
                                    is_outlier = true;
                                    outlier_score = 0.60;
                                    reasons.push("Anomalie sémantique non supervisée détectée (Outlier HDBSCAN / Vecteur isolé)".to_string());
                                }
                            }
                        }
                    }

                    let log_emb = LogEmbedding {
                        id: uuid::Uuid::new_v4().to_string(),
                        parsed_log_id: uuid::Uuid::new_v4().to_string(),
                        raw_log_id: raw_log.id.clone(),
                        embedding: vec_f64,
                        dimension: 384,
                        created_at: Utc::now(),
                    };
                    let _ = self.db.insert_log_embedding(&log_emb);
                }
            }
        }

        // 6. FUSION MULTI-AXES & SCORE DE RISQUE COMPOSITE
        let mut composite_score = (dlp_score * 0.30)
            + (template_score * 0.20)
            + (semantic_score * 0.25)
            + (time_score * 0.15)
            + (outlier_score * 0.10);

        if is_critical_hit {
            composite_score = composite_score.max(0.85);
        }

        let alert_level = if composite_score >= 0.70 {
            AlertLevel::High
        } else if composite_score >= 0.35 {
            AlertLevel::Moderate
        } else if composite_score >= 0.20 {
            AlertLevel::Low
        } else {
            AlertLevel::Benign
        };

        // 7. CRÉATION D'ALERTE ET VALIDATION CONTEXTUELLE LLM
        if alert_level != AlertLevel::Benign {
            let category = categorize_threat(raw_message, &reasons);
            
            // Extraction des logs voisins pour l'analyse de contexte
            let neighbor_logs = self.db.get_log_context_neighbors(&raw_log.id, Some(hostname), Some(timestamp), 10)
                .unwrap_or_default();

            let context_strings: Vec<String> = neighbor_logs.iter()
                .map(|l| format!("[{}] {}", l.timestamp.format("%H:%M:%S"), l.raw_message))
                .collect();

            // Appel synchrone/bloquant léger du LLM si activé
            let app_settings = self.app_settings.lock().clone();
            let mut llm_explanation = None;
            let mut mitigation_suggestion = None;

            if let Some(ref llm_cfg) = app_settings.llm {
                if llm_cfg.enabled {
                    let rt = tokio::runtime::Builder::new_current_thread().enable_all().build().ok();
                    if let Some(runtime) = rt {
                        if let Some((exp, mit, _is_threat)) = runtime.block_on(ContextualLlmAnalyzer::analyze_incident(
                            llm_cfg,
                            &raw_log,
                            &reasons,
                            &neighbor_logs,
                        )) {
                            llm_explanation = Some(exp);
                            mitigation_suggestion = Some(mit);
                        }
                    }
                }
            }

            let alert = Alert {
                id: uuid::Uuid::new_v4().to_string(),
                raw_log_id: raw_log.id.clone(),
                parsed_log_id: None,
                template: Some(parsed.template),
                category,
                supervised_score: Some(semantic_score),
                anomaly_score: Some(template_score),
                cluster_id: None,
                is_outlier,
                final_score: composite_score,
                level: alert_level,
                reasons,
                context_logs: context_strings,
                llm_explanation,
                mitigation_suggestion,
                detected_at: Utc::now(),
                acknowledged: false,
                acknowledged_at: None,
            };

            self.db.insert_alert(&alert)?;

            // 8. SOAR & Active Response & Webhooks
            if alert.level == AlertLevel::High {
                let _ = self.active_response.trigger_response(&alert);
            }

            // Webhook notification
            let webhook_target = app_settings.webhook_url.clone()
                .or_else(|| std::env::var("DefuDelog_WEBHOOK_URL").ok());

            if let Some(webhook_url) = webhook_target {
                if !webhook_url.trim().is_empty() {
                    let alert_clone = alert.clone();
                    std::thread::spawn(move || {
                        let rt = tokio::runtime::Builder::new_current_thread().enable_all().build().ok();
                        if let Some(runtime) = rt {
                            let _ = runtime.block_on(crate::webhook_notifier::WebhookNotifier::send_alert_notification(&webhook_url, &alert_clone));
                        }
                    });
                }
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
        || text.contains("password") || text.contains("dump")
        || text.contains("credit_cards") || text.contains("s3://") {
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
