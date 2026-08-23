use std::collections::{HashMap, HashSet};
use std::path::Path;
use parking_lot::RwLock;
use std::sync::Arc;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TranslationRule {
    #[serde(default)]
    pub category: String,
    pub pattern: String,
    pub template_format: String,
    #[serde(default)]
    pub explanation: Option<String>,
    #[serde(default)]
    pub recommendation: Option<String>,
    pub status_level: String, // "success", "error", "warning", "info"
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TranslatedLog {
    pub meaning: String,
    #[serde(default)]
    pub explanation: Option<String>,
    #[serde(default)]
    pub recommendation: Option<String>,
    pub status_level: String,
    pub is_learned: bool,
}

pub type CachedTranslation = (String, Option<String>, Option<String>, String);
pub type CustomTranslationTuple = (String, String, Option<String>, Option<String>, String);

pub struct LogTranslator {
    // Cache SQLite : pattern -> (format, explanation, recommendation, status_level)
    cache: Arc<RwLock<HashMap<String, CachedTranslation>>>,
    file_rules: Arc<RwLock<Vec<TranslationRule>>>,
}

impl Default for LogTranslator {
    fn default() -> Self {
        Self::new()
    }
}

impl LogTranslator {
    pub fn new() -> Self {
        let default_json = include_str!("../dictionaries/translations_fr.json");
        let initial_rules: Vec<TranslationRule> = serde_json::from_str(default_json).unwrap_or_default();

        Self {
            cache: Arc::new(RwLock::new(HashMap::new())),
            file_rules: Arc::new(RwLock::new(initial_rules)),
        }
    }

    /// Charge un fichier externe de dictionnaire JSON pour étendre ou mettre à jour les règles
    pub fn load_from_file(&self, path: &Path) -> Result<usize, String> {
        if !path.exists() {
            return Err(format!("Fichier de dictionnaire introuvable: {}", path.display()));
        }

        let content = std::fs::read_to_string(path).map_err(|e| e.to_string())?;
        let rules: Vec<TranslationRule> = serde_json::from_str(&content).map_err(|e| format!("Format JSON invalide: {}", e))?;
        let count = rules.len();

        let mut current_rules = self.file_rules.write();
        *current_rules = rules;
        Ok(count)
    }

    /// Télécharge et synchronise le dictionnaire depuis une URL distante (GitHub Releases OTA)
    pub async fn sync_remote_dictionary(&self, url: &str) -> Result<usize, String> {
        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(10))
            .build()
            .map_err(|e| e.to_string())?;

        let resp = client.get(url).send().await.map_err(|e| format!("Erreur réseau: {}", e))?;
        if !resp.status().is_success() {
            return Err(format!("Erreur HTTP: {}", resp.status()));
        }

        let content = resp.text().await.map_err(|e| e.to_string())?;
        let rules: Vec<TranslationRule> = serde_json::from_str(&content).map_err(|e| format!("JSON distant invalide: {}", e))?;
        let count = rules.len();

        if count > 0 {
            let mut current_rules = self.file_rules.write();
            *current_rules = rules;
        }

        Ok(count)
    }

    /// Retourne toutes les règles chargées en mémoire
    pub fn get_all_rules(&self) -> Vec<TranslationRule> {
        self.file_rules.read().clone()
    }

    /// Recharge le dictionnaire par défaut
    pub fn reload_default_dictionary(&self) -> usize {
        let default_json = include_str!("../dictionaries/translations_fr.json");
        let initial_rules: Vec<TranslationRule> = serde_json::from_str(default_json).unwrap_or_default();
        let count = initial_rules.len();
        let mut current_rules = self.file_rules.write();
        *current_rules = initial_rules;
        count
    }

    /// Charge les traductions personnalisées ou apprises depuis SQLite
    pub fn load_custom_translations(&self, translations: Vec<CustomTranslationTuple>) {
        let mut cache = self.cache.write();
        for (pattern, format, explanation, recommendation, level) in translations {
            cache.insert(pattern.to_lowercase(), (format, explanation, recommendation, level));
        }
    }

    /// Ajoute ou met à jour une traduction personnalisée dans le cache
    pub fn insert_custom_translation(&self, pattern: &str, format: &str, explanation: Option<String>, recommendation: Option<String>, level: &str) {
        let mut cache = self.cache.write();
        cache.insert(pattern.to_lowercase(), (format.to_string(), explanation, recommendation, level.to_string()));
    }

    /// Traduit un log brut en modèle sémantique multi-niveaux en français
    pub fn translate(&self, raw_message: &str, template: &str, params: &[String]) -> TranslatedLog {
        let clean_raw = raw_message.trim();
        let lower_raw = clean_raw.to_lowercase();
        let lower_tpl = template.to_lowercase();

        // 1. Vérifier dans le cache dynamique SQLite (Priorité maximale : règles personnalisées/apprises)
        {
            let cache = self.cache.read();
            for (pattern, (format_str, expl, reco, level)) in cache.iter() {
                if Self::matches_pattern(&lower_raw, &lower_tpl, pattern) {
                    let meaning = Self::interpolate(format_str, params, clean_raw);
                    let explanation = expl.as_ref().map(|s| Self::interpolate(s, params, clean_raw));
                    let recommendation = reco.as_ref().map(|s| Self::interpolate(s, params, clean_raw));
                    return TranslatedLog {
                        meaning,
                        explanation,
                        recommendation,
                        status_level: level.clone(),
                        is_learned: true,
                    };
                }
            }
        }

        // 2. Vérifier dans le dictionnaire JSON (Correspondance exacte ou séparateurs normalisés)
        {
            let rules = self.file_rules.read();
            for rule in rules.iter() {
                if Self::matches_pattern(&lower_raw, &lower_tpl, &rule.pattern.to_lowercase()) {
                    let meaning = Self::interpolate(&rule.template_format, params, clean_raw);
                    let explanation = rule.explanation.as_ref().map(|s| Self::interpolate(s, params, clean_raw));
                    let recommendation = rule.recommendation.as_ref().map(|s| Self::interpolate(s, params, clean_raw));
                    return TranslatedLog {
                        meaning,
                        explanation,
                        recommendation,
                        status_level: rule.status_level.clone(),
                        is_learned: false,
                    };
                }
            }

            // 3. Correspondance Floue (Fuzzy Jaccard Similarity sur les tokens normalisés)
            let mut best_rule: Option<(&TranslationRule, f64)> = None;
            for rule in rules.iter() {
                let sim = Self::token_jaccard_similarity(&lower_raw, &rule.pattern.to_lowercase());
                if sim >= 0.70 {
                    if let Some((_, best_sim)) = best_rule {
                        if sim > best_sim {
                            best_rule = Some((rule, sim));
                        }
                    } else {
                        best_rule = Some((rule, sim));
                    }
                }
            }

            if let Some((rule, _)) = best_rule {
                let meaning = Self::interpolate(&rule.template_format, params, clean_raw);
                let explanation = rule.explanation.as_ref().map(|s| Self::interpolate(s, params, clean_raw));
                let recommendation = rule.recommendation.as_ref().map(|s| Self::interpolate(s, params, clean_raw));
                return TranslatedLog {
                    meaning,
                    explanation,
                    recommendation,
                    status_level: rule.status_level.clone(),
                    is_learned: false,
                };
            }
        }

        // 4. Fallback heuristique intelligent si le log n'est pas encore répertorié
        let (fallback_meaning, expl, reco, level) = Self::heuristic_translation(clean_raw, template, params);
        TranslatedLog {
            meaning: fallback_meaning,
            explanation: Some(expl),
            recommendation: Some(reco),
            status_level: level,
            is_learned: false,
        }
    }

    /// Vérifie la correspondance d'un motif sur le log brut ou le template avec tolérance aux séparateurs
    fn matches_pattern(raw_lower: &str, tpl_lower: &str, pattern_lower: &str) -> bool {
        if raw_lower.contains(pattern_lower) || tpl_lower.contains(pattern_lower) {
            return true;
        }

        // Normalisation des séparateurs pour matcher "eventid=4625" avec "eventid: 4625" ou "eventid 4625"
        let norm_raw = raw_lower.replace(['=', ':', '_', '-'], " ");
        let norm_tpl = tpl_lower.replace(['=', ':', '_', '-'], " ");
        let norm_pat = pattern_lower.replace(['=', ':', '_', '-'], " ");

        norm_raw.contains(&norm_pat) || norm_tpl.contains(&norm_pat)
    }

    /// Calcul de similarité de Jaccard sur les tokens signifiants (> 2 caractères)
    fn token_jaccard_similarity(text1: &str, pattern: &str) -> f64 {
        let set1: HashSet<&str> = text1.split_whitespace().filter(|w| w.len() > 2).collect();
        let set2: HashSet<&str> = pattern.split_whitespace().filter(|w| w.len() > 2).collect();

        if set1.is_empty() || set2.is_empty() {
            return 0.0;
        }

        let intersection = set1.intersection(&set2).count();
        let union = set1.union(&set2).count();

        if union == 0 {
            0.0
        } else {
            intersection as f64 / union as f64
        }
    }

    /// Interpolation des variables nommées typées ({user}, {ip}, {port}, {file}, {table}, {status}, {cmd})
    /// et rétro-compatibilité avec les indices {0}, {1}...
    fn interpolate(format_str: &str, params: &[String], raw: &str) -> String {
        let mut result = format_str.to_string();

        // 1. Remplacement des index {0}, {1}, {2}...
        for (i, p) in params.iter().enumerate() {
            let placeholder = format!("{{{}}}", i);
            result = result.replace(&placeholder, p);
        }

        // 2. Extraction et remplacement des variables nommées typées
        let named_entities = Self::extract_all_named_entities(raw);

        if let Some(val) = &named_entities.ip { result = result.replace("{ip}", val); }
        if let Some(val) = &named_entities.user { result = result.replace("{user}", val); }
        if let Some(val) = &named_entities.port { result = result.replace("{port}", val); }
        if let Some(val) = &named_entities.cmd { result = result.replace("{cmd}", val); }
        if let Some(val) = &named_entities.file { result = result.replace("{file}", val).replace("{path}", val); }
        if let Some(val) = &named_entities.table { result = result.replace("{table}", val); }
        if let Some(val) = &named_entities.status { result = result.replace("{status}", val).replace("{code}", val); }
        if let Some(val) = &named_entities.app { result = result.replace("{app}", val); }
        if let Some(val) = &named_entities.domain { result = result.replace("{domain}", val); }

        // 3. Nettoyage des placeholders restants non résolus
        let re = regex::Regex::new(r"\{[a-zA-Z0-9_-]+\}").unwrap();
        result = re.replace_all(&result, "non spécifié").to_string();

        result
    }

    /// Extrait les entités nommées avec des regex typées pour garantir l'absence d'inversion
    fn extract_all_named_entities(text: &str) -> NamedEntities {
        let ip = regex::Regex::new(r"\b(?:\d{1,3}\.){3}\d{1,3}\b")
            .ok()
            .and_then(|re| re.find(text).map(|m| m.as_str().to_string()));

        let port = regex::Regex::new(r"(?i)\bport\s+(\d+)\b|:(\d{2,5})\b")
            .ok()
            .and_then(|re| {
                re.captures(text).and_then(|c| {
                    c.get(1).or_else(|| c.get(2)).map(|m| m.as_str().to_string())
                })
            });

        let user = regex::Regex::new(r"(?i)\b(?:for\s+invalid\s+user|for\s+user|user\s*=|account\s+name:|for|user|by)\s+['\x22]?([a-zA-Z0-9_\-\.\\]+)['\x22]?\b")
            .ok()
            .and_then(|re| {
                re.captures(text).and_then(|c| {
                    let u = c.get(1).map(|m| m.as_str().to_string())?;
                    if u.to_lowercase() == "user" || u.to_lowercase() == "invalid" {
                        // Fallback vers le mot suivant
                        regex::Regex::new(r"(?i)\b(?:for\s+user|user|invalid\s+user)\s+['\x22]?([a-zA-Z0-9_\-\.\\]+)['\x22]?\b")
                            .ok()
                            .and_then(|re2| re2.captures(text).and_then(|c2| c2.get(1).map(|m| m.as_str().to_string())))
                    } else {
                        Some(u)
                    }
                })
            });

        let cmd = regex::Regex::new(r"(?i)\bCOMMAND=([^\s]+)|\bcmd=([^\s]+)")
            .ok()
            .and_then(|re| {
                re.captures(text).and_then(|c| {
                    c.get(1).or_else(|| c.get(2)).map(|m| m.as_str().to_string())
                })
            });

        let file = regex::Regex::new(r"(?:/[a-zA-Z0-9_\.\-]+)+|[A-Za-z]:\\[a-zA-Z0-9_\.\-\\]+")
            .ok()
            .and_then(|re| re.find(text).map(|m| m.as_str().to_string()));

        let table = regex::Regex::new(r"(?i)\btable\s+['\x22]?([a-zA-Z0-9_\-\.]+)['\x22]?")
            .ok()
            .and_then(|re| re.captures(text).and_then(|c| c.get(1)).map(|m| m.as_str().to_string()));

        let status = regex::Regex::new(r"(?i)\b(?:status|code|HTTP/\d\.\d[\x22\s]+)\s*=?\s*(\d{3})\b")
            .ok()
            .and_then(|re| re.captures(text).and_then(|c| c.get(1)).map(|m| m.as_str().to_string()));

        let app = regex::Regex::new(r"^([a-zA-Z0-9_\-]+)(?:\[\d+\])?:")
            .ok()
            .and_then(|re| re.captures(text).and_then(|c| c.get(1)).map(|m| m.as_str().to_string()));

        let domain = regex::Regex::new(r"(?i)\b(?:domain|workgroup):\s*([a-zA-Z0-9_\-]+)\b")
            .ok()
            .and_then(|re| re.captures(text).and_then(|c| c.get(1)).map(|m| m.as_str().to_string()));

        NamedEntities {
            ip,
            user,
            port,
            cmd,
            file,
            table,
            status,
            app,
            domain,
        }
    }

    /// Heuristique de décomposition si aucun gabarit ne correspond
    fn heuristic_translation(raw: &str, template: &str, _params: &[String]) -> (String, String, String, String) {
        let lower = raw.to_lowercase();
        let entities = Self::extract_all_named_entities(raw);

        if lower.contains("error") || lower.contains("fail") || lower.contains("erreur") || lower.contains("fatal") {
            let entity_info = match (&entities.user, &entities.ip) {
                (Some(u), Some(i)) => format!(" (concernant l'utilisateur '{}' depuis l'IP {})", u, i),
                (Some(u), None) => format!(" (concernant l'utilisateur '{}')", u),
                (None, Some(i)) => format!(" (depuis l'adresse IP {})", i),
                _ => String::new(),
            };
            (
                format!("🔴 Événement d'erreur ou d'échec détecté{}", entity_info),
                "Ce journal signale une anomalie ou un rejet lors d'une opération système ou applicative.".to_string(),
                "Vérifiez les paramètres de configuration ou les journaux adjacents pour diagnostiquer l'origine de l'échec.".to_string(),
                "error".to_string(),
            )
        } else if lower.contains("warn") || lower.contains("alert") || lower.contains("denied") || lower.contains("refus") {
            (
                format!("⚠️ Avertissement de sécurité ou accès restreint : {}", template),
                "Une tentative d'accès a été restreinte ou un avertissement de fonctionnement a été émis.".to_string(),
                "Contrôlez si cette action émane d'un compte autorisé et vérifiez l'intégrité des permissions.".to_string(),
                "warning".to_string(),
            )
        } else if lower.contains("accepted") || lower.contains("success") || lower.contains("réussi") || lower.contains("valid") {
            let user_str = entities.user.as_ref().map(|u| format!(" pour '{}'", u)).unwrap_or_default();
            (
                format!("🟢 Opération ou authentification validée avec succès{}", user_str),
                "L'action demandée a été exécutée et autorisée normalement par le sous-système hôte.".to_string(),
                "Aucune action requise (activité opérationnelle conforme).".to_string(),
                "success".to_string(),
            )
        } else {
            (
                format!("ℹ️ Activité opérationnelle : {}", template),
                "Journal système standard retraçant le cycle de vie normal d'un service ou processus hôte.".to_string(),
                "Information archivée pour la traçabilité et l'audit chronologique.".to_string(),
                "info".to_string(),
            )
        }
    }
}

#[derive(Debug, Default)]
struct NamedEntities {
    ip: Option<String>,
    user: Option<String>,
    port: Option<String>,
    cmd: Option<String>,
    file: Option<String>,
    table: Option<String>,
    status: Option<String>,
    app: Option<String>,
    domain: Option<String>,
}
