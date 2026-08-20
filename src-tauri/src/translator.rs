use std::collections::HashMap;
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
    pub status_level: String, // "success", "error", "warning", "info"
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TranslatedLog {
    pub meaning: String,
    pub status_level: String,
    pub is_learned: bool,
}

pub struct LogTranslator {
    cache: Arc<RwLock<HashMap<String, (String, String)>>>,
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
    pub fn load_custom_translations(&self, translations: Vec<(String, String, String)>) {
        let mut cache = self.cache.write();
        for (pattern, format, level) in translations {
            cache.insert(pattern.to_lowercase(), (format, level));
        }
    }

    /// Traduit un log brut en phrase vulgarisée en français clair
    pub fn translate(&self, raw_message: &str, template: &str, params: &[String]) -> TranslatedLog {
        let clean_raw = raw_message.trim();
        let lower_raw = clean_raw.to_lowercase();
        let lower_tpl = template.to_lowercase();

        // 1. Vérifier dans le cache dynamique SQLite
        {
            let cache = self.cache.read();
            for (pattern, (format_str, level)) in cache.iter() {
                if lower_tpl.contains(pattern) || lower_raw.contains(pattern) {
                    let meaning = Self::interpolate(format_str, params, clean_raw);
                    return TranslatedLog {
                        meaning,
                        status_level: level.clone(),
                        is_learned: true,
                    };
                }
            }
        }

        // 2. Vérifier dans le dictionnaire JSON (embarqué + surcouche fichier)
        {
            let rules = self.file_rules.read();
            for rule in rules.iter() {
                if lower_tpl.contains(&rule.pattern.to_lowercase()) || lower_raw.contains(&rule.pattern.to_lowercase()) {
                    let meaning = Self::interpolate(&rule.template_format, params, clean_raw);
                    return TranslatedLog {
                        meaning,
                        status_level: rule.status_level.clone(),
                        is_learned: false,
                    };
                }
            }
        }

        // 3. Fallback heuristique intelligent si le log n'est pas encore dans le dictionnaire
        let (fallback_meaning, level) = Self::heuristic_translation(clean_raw, template, params);
        TranslatedLog {
            meaning: fallback_meaning,
            status_level: level,
            is_learned: false,
        }
    }

    /// Interpolation des variables {0}, {1}, {2}... ou extraction intelligente
    fn interpolate(format_str: &str, params: &[String], raw: &str) -> String {
        let mut result = format_str.to_string();

        for (i, p) in params.iter().enumerate() {
            let placeholder = format!("{{{}}}", i);
            result = result.replace(&placeholder, p);
        }

        // Si le format contient des balises génériques non remplies, injecter intelligemment les entités
        if result.contains("{ip}") || result.contains("{user}") || result.contains("{port}") || result.contains("{cmd}") {
            let (ip, user, port, cmd) = Self::extract_common_entities(raw);
            if let Some(val) = ip { result = result.replace("{ip}", &val); }
            if let Some(val) = user { result = result.replace("{user}", &val); }
            if let Some(val) = port { result = result.replace("{port}", &val); }
            if let Some(val) = cmd { result = result.replace("{cmd}", &val); }
        }

        // Nettoyage des placeholders restants non résolus
        let re = regex::Regex::new(r"\{[a-zA-Z0-9_-]+\}").unwrap();
        result = re.replace_all(&result, "non spécifié").to_string();

        result
    }

    /// Extrait les entités fréquentes (IP, User, Port, Commande) par expressions régulières directes
    fn extract_common_entities(text: &str) -> (Option<String>, Option<String>, Option<String>, Option<String>) {
        let ip = regex::Regex::new(r"\b(?:\d{1,3}\.){3}\d{1,3}\b")
            .ok()
            .and_then(|re| re.find(text).map(|m| m.as_str().to_string()));

        let port = regex::Regex::new(r"\bport\s+(\d+)\b")
            .ok()
            .and_then(|re| re.captures(text).and_then(|c| c.get(1)).map(|m| m.as_str().to_string()));

        let user = regex::Regex::new(r"\b(?:for|user|by)\s+([a-zA-Z0-9_\-\.]+)\b")
            .ok()
            .and_then(|re| re.captures(text).and_then(|c| c.get(1)).map(|m| m.as_str().to_string()));

        let cmd = regex::Regex::new(r"\bCOMMAND=([^\s]+)")
            .ok()
            .and_then(|re| re.captures(text).and_then(|c| c.get(1)).map(|m| m.as_str().to_string()));

        (ip, user, port, cmd)
    }

    /// Heuristique de décomposition si aucun gabarit ne correspond
    fn heuristic_translation(raw: &str, template: &str, _params: &[String]) -> (String, String) {
        let lower = raw.to_lowercase();
        let (ip, user, _, _) = Self::extract_common_entities(raw);

        if lower.contains("error") || lower.contains("fail") || lower.contains("erreur") || lower.contains("fatal") {
            let entity_info = match (user, ip) {
                (Some(u), Some(i)) => format!(" (concernant l'utilisateur '{}' depuis l'IP {})", u, i),
                (Some(u), None) => format!(" (concernant l'utilisateur '{}')", u),
                (None, Some(i)) => format!(" (depuis l'adresse IP {})", i),
                _ => String::new(),
            };
            (format!("🔴 Événement d'erreur ou d'échec détecté{}", entity_info), "error".to_string())
        } else if lower.contains("warn") || lower.contains("alert") || lower.contains("denied") || lower.contains("refus") {
            (format!("⚠️ Avertissement de sécurité ou accès restreint : {}", template), "warning".to_string())
        } else if lower.contains("accepted") || lower.contains("success") || lower.contains("réussi") || lower.contains("valid") {
            let user_str = user.map(|u| format!(" pour '{}'", u)).unwrap_or_default();
            (format!("🟢 Opération ou authentification validée avec succès{}", user_str), "success".to_string())
        } else {
            (format!("ℹ️ Activité opérationnelle : {}", template), "info".to_string())
        }
    }
}
