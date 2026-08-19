use rusqlite::{Connection, params};
use parking_lot::Mutex;
use std::path::Path;
use std::sync::Arc;

use crate::models::*;
use crate::error::AppError;

pub struct Database {
    conn: Arc<Mutex<Connection>>,
}

impl Database {
    /// Initialise la base de données, crée les tables si nécessaire
    pub fn new(path: &str) -> Result<Self, AppError> {
        let exists = Path::new(path).exists();
        let conn = Connection::open(path)?;
        
        // Chiffrement SQLCipher (AES-256)
        conn.pragma_update(None, "key", "defudolog_secret_key_2026")?;
        
        let db = Self {
            conn: Arc::new(Mutex::new(conn)),
        };
        db.run_migrations()?;
        if !exists {
            db.seed_defaults()?;
        }
        Ok(db)
    }

    /// Exécute les migrations SQL
    fn run_migrations(&self) -> Result<(), AppError> {
        let conn = self.conn.lock();
        conn.execute_batch("
            PRAGMA journal_mode = WAL;
            PRAGMA foreign_keys = ON;
            PRAGMA synchronous = NORMAL;
            PRAGMA cache_size = -64000;
            PRAGMA mmap_size = 268435456;

            CREATE TABLE IF NOT EXISTS log_sources (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                source_type TEXT NOT NULL,
                hostname TEXT NOT NULL,
                os TEXT NOT NULL DEFAULT 'unknown',
                enabled INTEGER NOT NULL DEFAULT 1,
                config TEXT NOT NULL DEFAULT '{}',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS raw_logs (
                id TEXT PRIMARY KEY,
                source_id TEXT NOT NULL,
                hostname TEXT NOT NULL,
                raw_message TEXT NOT NULL,
                log_hash TEXT NOT NULL,
                timestamp TEXT NOT NULL,
                ingested_at TEXT NOT NULL,
                FOREIGN KEY (source_id) REFERENCES log_sources(id)
            );

            CREATE INDEX IF NOT EXISTS idx_raw_logs_hash ON raw_logs(log_hash);
            CREATE INDEX IF NOT EXISTS idx_raw_logs_timestamp ON raw_logs(timestamp);
            CREATE INDEX IF NOT EXISTS idx_raw_logs_source ON raw_logs(source_id);

            CREATE TABLE IF NOT EXISTS parsed_logs (
                id TEXT PRIMARY KEY,
                raw_log_id TEXT NOT NULL UNIQUE,
                raw_message TEXT NOT NULL,
                template TEXT NOT NULL,
                template_id INTEGER NOT NULL,
                parameters TEXT NOT NULL DEFAULT '[]',
                parsed_at TEXT NOT NULL,
                FOREIGN KEY (raw_log_id) REFERENCES raw_logs(id)
            );

            CREATE INDEX IF NOT EXISTS idx_parsed_template ON parsed_logs(template_id);

            CREATE TABLE IF NOT EXISTS log_embeddings (
                id TEXT PRIMARY KEY,
                parsed_log_id TEXT NOT NULL,
                raw_log_id TEXT NOT NULL,
                embedding BLOB NOT NULL,
                dimension INTEGER NOT NULL DEFAULT 768,
                created_at TEXT NOT NULL,
                FOREIGN KEY (parsed_log_id) REFERENCES parsed_logs(id),
                FOREIGN KEY (raw_log_id) REFERENCES raw_logs(id)
            );

            CREATE INDEX IF NOT EXISTS idx_embeddings_raw ON log_embeddings(raw_log_id);

            CREATE TABLE IF NOT EXISTS cluster_results (
                id TEXT PRIMARY KEY,
                embedding_id TEXT NOT NULL,
                raw_log_id TEXT NOT NULL,
                cluster_id INTEGER NOT NULL,
                is_outlier INTEGER NOT NULL DEFAULT 0,
                labeled_at TEXT NOT NULL,
                FOREIGN KEY (embedding_id) REFERENCES log_embeddings(id),
                FOREIGN KEY (raw_log_id) REFERENCES raw_logs(id)
            );

            CREATE INDEX IF NOT EXISTS idx_cluster_id ON cluster_results(cluster_id);

            CREATE TABLE IF NOT EXISTS alerts (
                id TEXT PRIMARY KEY,
                raw_log_id TEXT NOT NULL,
                parsed_log_id TEXT,
                template TEXT,
                category TEXT NOT NULL DEFAULT 'general',
                supervised_score REAL,
                anomaly_score REAL,
                cluster_id INTEGER,
                is_outlier INTEGER NOT NULL DEFAULT 0,
                final_score REAL NOT NULL,
                level TEXT NOT NULL DEFAULT 'low',
                reasons TEXT NOT NULL DEFAULT '[]',
                context_logs TEXT NOT NULL DEFAULT '[]',
                llm_explanation TEXT,
                mitigation_suggestion TEXT,
                detected_at TEXT NOT NULL,
                acknowledged INTEGER NOT NULL DEFAULT 0,
                acknowledged_at TEXT,
                FOREIGN KEY (raw_log_id) REFERENCES raw_logs(id)
            );

            CREATE INDEX IF NOT EXISTS idx_alerts_level ON alerts(level);
            CREATE INDEX IF NOT EXISTS idx_alerts_time ON alerts(detected_at);

            CREATE TABLE IF NOT EXISTS detection_rules (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                description TEXT NOT NULL DEFAULT '',
                rule_type TEXT NOT NULL,
                pattern TEXT NOT NULL,
                severity TEXT NOT NULL DEFAULT 'moderate',
                enabled INTEGER NOT NULL DEFAULT 1,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS template_frequencies (
                template TEXT NOT NULL,
                template_id INTEGER NOT NULL PRIMARY KEY,
                count INTEGER NOT NULL DEFAULT 0,
                alert_count INTEGER NOT NULL DEFAULT 0,
                last_seen TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS app_settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );
        ")?;

        // Safe column additions for existing databases
        let _ = conn.execute("ALTER TABLE alerts ADD COLUMN llm_explanation TEXT", []);
        let _ = conn.execute("ALTER TABLE alerts ADD COLUMN mitigation_suggestion TEXT", []);

        // Purge automatique de toute fausse source ou donnée démo résiduelle
        let _ = conn.execute("DELETE FROM log_sources WHERE id LIKE 'demo_%' OR os = 'demo'", []);
        let _ = conn.execute("DELETE FROM raw_logs WHERE source_id LIKE 'demo_%'", []);

        Ok(())
    }

    /// Purge manuelle explicite des données de démonstration
    pub fn purge_demo_sources(&self) -> Result<(), AppError> {
        let conn = self.conn.lock();
        conn.execute("DELETE FROM log_sources WHERE id LIKE 'demo_%' OR os = 'demo'", [])?;
        conn.execute("DELETE FROM raw_logs WHERE source_id LIKE 'demo_%'", [])?;
        Ok(())
    }

    /// Insère les valeurs par défaut (règles, settings)
    fn seed_defaults(&self) -> Result<(), AppError> {
        let conn = self.conn.lock();

        // Règles de détection par défaut
        let default_rules = vec![
            ("keyword-sens", "Mot-clé sensible", "keyword", "sens|secret|confidentiel|password|token|api_key", "high"),
            ("keyword-ip-blacklist", "IP sur liste noire", "ip_blacklist", "192.168.1.42|192.168.1.28|10.0.0.99", "high"),
            ("user-blacklist", "Utilisateur compromis", "user_blacklist", "root|attacker19|cyrus", "high"),
            ("time-suspect", "Heure suspecte", "time_window", "19-21", "moderate"),
            ("transfer-suspect", "Transfert de fichier suspect", "regex", r"scp|ftp|rsync|curl.*-o|wget", "high"),
            ("auth-failure-burst", "Rafale d'échecs d'auth", "template_match", "Failed password", "moderate"),
        ];

        for (id, name, rule_type, pattern, severity) in &default_rules {
            conn.execute(
                "INSERT OR IGNORE INTO detection_rules (id, name, description, rule_type, pattern, severity, enabled, created_at)
                 VALUES (?1, ?2, '', ?3, ?4, ?5, 1, datetime('now'))",
                params![id, name, rule_type, pattern, severity],
            )?;
        }

        // Settings par défaut
        let default_settings = AppSettings::default();
        let settings_json = serde_json::to_string(&default_settings)?;
        conn.execute(
            "INSERT OR REPLACE INTO app_settings (key, value) VALUES ('main', ?1)",
            params![settings_json],
        )?;

        Ok(())
    }

    // ─── Log Sources ────────────────────────────────────

    pub fn insert_log_source(&self, source: &LogSource) -> Result<(), AppError> {
        let conn = self.conn.lock();
        conn.execute(
            "INSERT OR REPLACE INTO log_sources (id, name, source_type, hostname, os, enabled, config, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![
                source.id,
                source.name,
                source.source_type.to_string(),
                source.hostname,
                source.os,
                source.enabled as i32,
                serde_json::to_string(&source.config)?,
                source.created_at.to_rfc3339(),
                source.updated_at.to_rfc3339(),
            ],
        )?;
        Ok(())
    }

    pub fn get_log_sources(&self) -> Result<Vec<LogSource>, AppError> {
        let conn = self.conn.lock();
        let mut stmt = conn.prepare(
            "SELECT id, name, source_type, hostname, os, enabled, config, created_at, updated_at
             FROM log_sources ORDER BY created_at DESC"
        )?;
        let rows = stmt.query_map([], |row| {
            let source_type_str: String = row.get(2)?;
            let config_val: serde_json::Value = serde_json::from_str(&row.get::<_, String>(6)?).unwrap_or_default();
            let source_type = match source_type_str.as_str() {
                "file_watcher" => SourceType::FileWatcher {
                    path: config_val["path"].as_str().unwrap_or("").to_string(),
                    pattern: config_val["pattern"].as_str().unwrap_or("*").to_string(),
                },
                "windows_event_log" => SourceType::WindowsEventLog {
                    channel: config_val["channel"].as_str().unwrap_or("Security").to_string(),
                    query: config_val["query"].as_str().map(|s| s.to_string()),
                },
                "macos_unified_log" => SourceType::MacOsUnifiedLog {
                    predicate: config_val["predicate"].as_str().map(|s| s.to_string()),
                },
                "journald" => SourceType::Journald {
                    unit_filter: config_val["unit_filter"].as_str().map(|s| s.to_string()),
                },
                "network_syslog" => SourceType::NetworkSyslog {
                    port: config_val["port"].as_u64().unwrap_or(1514) as u16,
                    protocol: config_val["protocol"].as_str().unwrap_or("udp/tcp").to_string(),
                },
                "kafka" => SourceType::Kafka {
                    topic: config_val["topic"].as_str().unwrap_or("logs").to_string(),
                    brokers: config_val["brokers"].as_array()
                        .map(|a| a.iter().filter_map(|v| v.as_str().map(String::from)).collect())
                        .unwrap_or_default(),
                },
                _ => SourceType::FileWatcher {
                    path: config_val["path"].as_str().unwrap_or("").to_string(),
                    pattern: config_val["pattern"].as_str().unwrap_or("*").to_string(),
                },
            };

            Ok(LogSource {
                id: row.get(0)?,
                name: row.get(1)?,
                source_type,
                hostname: row.get(3)?,
                os: row.get(4)?,
                enabled: row.get::<_, i32>(5)? != 0,
                config: config_val,
                created_at: chrono::DateTime::parse_from_rfc3339(&row.get::<_, String>(7)?)
                    .map(|dt| dt.with_timezone(&chrono::Utc))
                    .unwrap_or_default(),
                updated_at: chrono::DateTime::parse_from_rfc3339(&row.get::<_, String>(8)?)
                    .map(|dt| dt.with_timezone(&chrono::Utc))
                    .unwrap_or_default(),
            })
        })?;
        rows.filter_map(|r| r.ok()).collect::<Vec<_>>().into_iter().map(Ok).collect()
    }

    pub fn update_source_enabled(&self, id: &str, enabled: bool) -> Result<(), AppError> {
        let conn = self.conn.lock();
        conn.execute(
            "UPDATE log_sources SET enabled = ?1, updated_at = datetime('now') WHERE id = ?2",
            params![enabled as i32, id],
        )?;
        Ok(())
    }

    pub fn delete_log_source(&self, id: &str) -> Result<(), AppError> {
        let conn = self.conn.lock();
        conn.execute("DELETE FROM log_sources WHERE id = ?1", params![id])?;
        Ok(())
    }

    // ─── Raw Logs ───────────────────────────────────────

    pub fn insert_raw_log(&self, log: &RawLog) -> Result<(), AppError> {
        let conn = self.conn.lock();
        conn.execute(
            "INSERT OR IGNORE INTO raw_logs (id, source_id, hostname, raw_message, log_hash, timestamp, ingested_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                log.id,
                log.source_id,
                log.hostname,
                log.raw_message,
                log.log_hash,
                log.timestamp.to_rfc3339(),
                log.ingested_at.to_rfc3339(),
            ],
        )?;
        Ok(())
    }

    pub fn insert_raw_logs_batch(&self, logs: &[RawLog]) -> Result<usize, AppError> {
        let conn = self.conn.lock();
        let tx = conn.unchecked_transaction()?;
        let mut count = 0;
        for log in logs {
            let result = tx.execute(
                "INSERT OR IGNORE INTO raw_logs (id, source_id, hostname, raw_message, log_hash, timestamp, ingested_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                params![
                    log.id,
                    log.source_id,
                    log.hostname,
                    log.raw_message,
                    log.log_hash,
                    log.timestamp.to_rfc3339(),
                    log.ingested_at.to_rfc3339(),
                ],
            );
            if result.is_ok() {
                count += result.unwrap();
            }
        }
        tx.commit()?;
        Ok(count)
    }

    pub fn insert_log_embedding(&self, embedding: &crate::models::LogEmbedding) -> Result<(), AppError> {
        let conn = self.conn.lock();
        let embedding_json = serde_json::to_string(&embedding.embedding)?;
        conn.execute(
            "INSERT INTO log_embeddings (id, raw_log_id, embedding_vector)
             VALUES (?1, ?2, ?3)",
            params![
                embedding.id,
                embedding.raw_log_id,
                embedding_json,
            ],
        )?;
        Ok(())
    }

    pub fn get_raw_logs(
        &self,
        limit: usize,
        offset: usize,
        source_id: Option<&str>,
        search: Option<&str>,
    ) -> Result<(Vec<RawLog>, u64), AppError> {
        let conn = self.conn.lock();

        let where_clause = match (source_id, search) {
            (Some(s), Some(q)) => format!("WHERE source_id = '{}' AND raw_message LIKE '%{}%'", s, q),
            (Some(s), None) => format!("WHERE source_id = '{}'", s),
            (None, Some(q)) => format!("WHERE raw_message LIKE '%{}%'", q),
            (None, None) => String::new(),
        };

        let count: u64 = conn.query_row(
            &format!("SELECT COUNT(*) FROM raw_logs {}", where_clause),
            [],
            |row| row.get(0),
        )?;

        let mut stmt = conn.prepare(&format!(
            "SELECT id, source_id, hostname, raw_message, log_hash, timestamp, ingested_at
             FROM raw_logs {} ORDER BY timestamp DESC LIMIT ?1 OFFSET ?2",
            where_clause
        ))?;

        let rows = stmt.query_map(params![limit as i64, offset as i64], |row| {
            Ok(RawLog {
                id: row.get(0)?,
                source_id: row.get(1)?,
                hostname: row.get(2)?,
                raw_message: row.get(3)?,
                log_hash: row.get(4)?,
                timestamp: parse_datetime(&row.get::<_, String>(5)?),
                ingested_at: parse_datetime(&row.get::<_, String>(6)?),
            })
        })?;

        let logs: Vec<RawLog> = rows.filter_map(|r| r.ok()).collect();
        Ok((logs, count))
    }

    // ─── Alerts ─────────────────────────────────────────

    pub fn insert_alert(&self, alert: &Alert) -> Result<(), AppError> {
        let conn = self.conn.lock();
        conn.execute(
            "INSERT OR REPLACE INTO alerts (id, raw_log_id, parsed_log_id, template, category, supervised_score,
             anomaly_score, cluster_id, is_outlier, final_score, level, reasons, context_logs,
             llm_explanation, mitigation_suggestion, detected_at, acknowledged, acknowledged_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18)",
            params![
                alert.id,
                alert.raw_log_id,
                alert.parsed_log_id,
                alert.template,
                alert.category.to_string(),
                alert.supervised_score,
                alert.anomaly_score,
                alert.cluster_id,
                alert.is_outlier as i32,
                alert.final_score,
                alert.level.to_string(),
                serde_json::to_string(&alert.reasons)?,
                serde_json::to_string(&alert.context_logs)?,
                alert.llm_explanation,
                alert.mitigation_suggestion,
                alert.detected_at.to_rfc3339(),
                alert.acknowledged as i32,
                alert.acknowledged_at.as_ref().map(|d| d.to_rfc3339()),
            ],
        )?;
        Ok(())
    }

    pub fn get_alerts(
        &self,
        level: Option<&str>,
        acknowledged: Option<bool>,
        limit: usize,
        offset: usize,
    ) -> Result<(Vec<Alert>, u64), AppError> {
        let conn = self.conn.lock();

        let mut conditions = Vec::new();
        if let Some(l) = level {
            conditions.push(format!("level = '{}'", l));
        }
        if let Some(ack) = acknowledged {
            conditions.push(format!("acknowledged = {}", ack as i32));
        }
        let where_clause = if conditions.is_empty() {
            String::new()
        } else {
            format!("WHERE {}", conditions.join(" AND "))
        };

        let count: u64 = conn.query_row(
            &format!("SELECT COUNT(*) FROM alerts {}", where_clause),
            [],
            |row| row.get(0),
        )?;

        let mut stmt = conn.prepare(&format!(
            "SELECT id, raw_log_id, parsed_log_id, template, category, supervised_score, anomaly_score,
             cluster_id, is_outlier, final_score, level, reasons, context_logs,
             llm_explanation, mitigation_suggestion, detected_at, acknowledged, acknowledged_at
             FROM alerts {} ORDER BY detected_at DESC LIMIT ?1 OFFSET ?2",
            where_clause
        ))?;

        let rows = stmt.query_map(params![limit as i64, offset as i64], |row| {
            let category_str: String = row.get(4)?;
            let reasons_str: String = row.get(11)?;
            let context_str: String = row.get(12)?;
            Ok(Alert {
                id: row.get(0)?,
                raw_log_id: row.get(1)?,
                parsed_log_id: row.get(2)?,
                template: row.get(3)?,
                category: parse_alert_category(&category_str),
                supervised_score: row.get(5)?,
                anomaly_score: row.get(6)?,
                cluster_id: row.get(7)?,
                is_outlier: row.get::<_, i32>(8)? != 0,
                final_score: row.get(9)?,
                level: parse_alert_level(&row.get::<_, String>(10)?),
                reasons: serde_json::from_str(&reasons_str).unwrap_or_default(),
                context_logs: serde_json::from_str(&context_str).unwrap_or_default(),
                llm_explanation: row.get(13)?,
                mitigation_suggestion: row.get(14)?,
                detected_at: parse_datetime(&row.get::<_, String>(15)?),
                acknowledged: row.get::<_, i32>(16)? != 0,
                acknowledged_at: row.get::<_, Option<String>>(17)?.map(|s| parse_datetime(&s)),
            })
        })?;

        let alerts: Vec<Alert> = rows.filter_map(|r| r.ok()).collect();
        Ok((alerts, count))
    }

    /// Récupère les logs voisins chronologiques (fenêtre glissante ± limit logs sur le même hôte/source)
    pub fn get_log_context_neighbors(
        &self,
        raw_log_id: &str,
        hostname: Option<&str>,
        timestamp: Option<chrono::DateTime<chrono::Utc>>,
        limit: usize,
    ) -> Result<Vec<RawLog>, AppError> {
        let conn = self.conn.lock();
        let ts_str = timestamp.map(|t| t.to_rfc3339()).unwrap_or_else(|| {
            conn.query_row(
                "SELECT timestamp FROM raw_logs WHERE id = ?1",
                params![raw_log_id],
                |r| r.get(0),
            ).unwrap_or_else(|_| chrono::Utc::now().to_rfc3339())
        });

        let host_filter = if let Some(h) = hostname {
            format!("AND hostname = '{}'", h)
        } else {
            String::new()
        };

        // Logs précédents
        let mut before_stmt = conn.prepare(&format!(
            "SELECT id, source_id, hostname, raw_message, log_hash, timestamp, ingested_at
             FROM raw_logs
             WHERE timestamp <= ?1 {}
             ORDER BY timestamp DESC LIMIT ?2",
            host_filter
        ))?;

        let before_rows = before_stmt.query_map(params![ts_str, limit as i64], |row| {
            Ok(RawLog {
                id: row.get(0)?,
                source_id: row.get(1)?,
                hostname: row.get(2)?,
                raw_message: row.get(3)?,
                log_hash: row.get(4)?,
                timestamp: parse_datetime(&row.get::<_, String>(5)?),
                ingested_at: parse_datetime(&row.get::<_, String>(6)?),
            })
        })?;

        let mut logs: Vec<RawLog> = before_rows.filter_map(|r| r.ok()).collect();
        logs.reverse(); // Ordre chronologique

        // Logs suivants
        let mut after_stmt = conn.prepare(&format!(
            "SELECT id, source_id, hostname, raw_message, log_hash, timestamp, ingested_at
             FROM raw_logs
             WHERE timestamp > ?1 {}
             ORDER BY timestamp ASC LIMIT ?2",
            host_filter
        ))?;

        let after_rows = after_stmt.query_map(params![ts_str, limit as i64], |row| {
            Ok(RawLog {
                id: row.get(0)?,
                source_id: row.get(1)?,
                hostname: row.get(2)?,
                raw_message: row.get(3)?,
                log_hash: row.get(4)?,
                timestamp: parse_datetime(&row.get::<_, String>(5)?),
                ingested_at: parse_datetime(&row.get::<_, String>(6)?),
            })
        })?;

        for r in after_rows.filter_map(|r| r.ok()) {
            logs.push(r);
        }

        Ok(logs)
    }

    pub fn insert_or_ignore_network_source(&self, id: &str, hostname: &str, ip: &str) -> Result<(), AppError> {
        let conn = self.conn.lock();
        let config_json = serde_json::json!({ "ip": ip, "protocol": "udp/tcp", "port": 1514 }).to_string();
        conn.execute(
            "INSERT OR IGNORE INTO log_sources (id, name, source_type, hostname, os, enabled, config, created_at, updated_at)
             VALUES (?1, ?2, 'network_syslog', ?3, 'remote_network', 1, ?4, datetime('now'), datetime('now'))",
            params![id, format!("Syslog ({})", hostname), hostname, config_json],
        )?;
        Ok(())
    }

    pub fn get_network_nodes(&self) -> Result<Vec<NetworkNode>, AppError> {
        let conn = self.conn.lock();
        let mut stmt = conn.prepare(
            "SELECT hostname, source_id, COUNT(*) as log_count, MAX(ingested_at) as last_seen
             FROM raw_logs
             GROUP BY hostname
             ORDER BY last_seen DESC",
        )?;

        let rows = stmt.query_map([], |row| {
            let hostname: String = row.get(0)?;
            let source_id: String = row.get(1)?;
            let count: u64 = row.get(2)?;
            let last_seen_str: String = row.get(3)?;
            let ip_address = if source_id.starts_with("network_syslog_") {
                source_id.trim_start_matches("network_syslog_").to_string()
            } else {
                "127.0.0.1".to_string()
            };

            Ok(NetworkNode {
                hostname,
                ip_address,
                log_count: count,
                last_seen: parse_datetime(&last_seen_str),
                os: "linux/unix".to_string(),
            })
        })?;

        let nodes: Vec<NetworkNode> = rows.filter_map(|r| r.ok()).collect();
        Ok(nodes)
    }

    pub fn acknowledge_alert(&self, id: &str) -> Result<(), AppError> {
        let conn = self.conn.lock();
        conn.execute(
            "UPDATE alerts SET acknowledged = 1, acknowledged_at = datetime('now') WHERE id = ?1",
            params![id],
        )?;
        Ok(())
    }

    // ─── Statistics ─────────────────────────────────────

    pub fn get_dashboard_stats(&self) -> Result<DashboardStats, AppError> {
        let conn = self.conn.lock();

        let total_logs: u64 = conn.query_row("SELECT COUNT(*) FROM raw_logs", [], |r| r.get(0))?;
        let logs_24h: u64 = conn.query_row(
            "SELECT COUNT(*) FROM raw_logs WHERE timestamp > datetime('now', '-24 hours')",
            [], |r| r.get(0),
        )?;
        let active_sources: u32 = conn.query_row(
            "SELECT COUNT(*) FROM log_sources WHERE enabled = 1",
            [], |r| r.get(0),
        )?;
        let total_templates: u64 = conn.query_row(
            "SELECT COUNT(DISTINCT template_id) FROM parsed_logs",
            [], |r| r.get(0),
        )?;
        let total_alerts: u64 = conn.query_row("SELECT COUNT(*) FROM alerts", [], |r| r.get(0))?;
        let high_alerts: u64 = conn.query_row(
            "SELECT COUNT(*) FROM alerts WHERE level = 'high'",
            [], |r| r.get(0),
        )?;
        let moderate_alerts: u64 = conn.query_row(
            "SELECT COUNT(*) FROM alerts WHERE level = 'moderate'",
            [], |r| r.get(0),
        )?;
        let alerts_24h: u64 = conn.query_row(
            "SELECT COUNT(*) FROM alerts WHERE detected_at > datetime('now', '-24 hours')",
            [], |r| r.get(0),
        )?;

        // Top templates
        let mut stmt = conn.prepare(
            "SELECT template, count, alert_count FROM template_frequencies ORDER BY alert_count DESC LIMIT 10"
        )?;
        let top_templates: Vec<TemplateFrequency> = stmt.query_map([], |row| {
            Ok(TemplateFrequency {
                template: row.get(0)?,
                count: row.get(1)?,
                alert_count: row.get(2)?,
            })
        })?.filter_map(|r| r.ok()).collect();

        // Alerte trend (last 7 days)
        let mut stmt = conn.prepare(
            "SELECT date(detected_at) as day, COUNT(*) as cnt
             FROM alerts WHERE detected_at > datetime('now', '-7 days')
             GROUP BY day ORDER BY day"
        )?;
        let alert_trend: Vec<(String, u64)> = stmt.query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, u64>(1)?))
        })?.filter_map(|r| r.ok()).collect();

        Ok(DashboardStats {
            total_logs,
            logs_last_24h: logs_24h,
            active_sources,
            total_templates,
            total_alerts,
            high_alerts,
            moderate_alerts,
            alerts_last_24h: alerts_24h,
            top_templates,
            alert_trend,
        })
    }

    pub fn get_timeseries_stats(&self) -> Result<Vec<TimeSeriesPoint>, AppError> {
        let conn = self.conn.lock();
        let now = chrono::Utc::now();
        let mut points = Vec::with_capacity(24);

        for i in (0..24).rev() {
            let target_hour = now - chrono::Duration::hours(i);
            let hour_str = target_hour.format("%Y-%m-%d %H").to_string();
            let label = target_hour.format("%H:00").to_string();

            // Match SQLite datetime substring or standard RFC3339 prefix
            let pattern = format!("{}%", hour_str.replace(' ', "T"));
            let pattern_alt = format!("{}%", hour_str);

            let logs: u64 = conn.query_row(
                "SELECT COUNT(*) FROM raw_logs WHERE timestamp LIKE ?1 OR timestamp LIKE ?2",
                params![pattern, pattern_alt],
                |r| r.get(0),
            ).unwrap_or(0);

            let alerts: u64 = conn.query_row(
                "SELECT COUNT(*) FROM alerts WHERE detected_at LIKE ?1 OR detected_at LIKE ?2",
                params![pattern, pattern_alt],
                |r| r.get(0),
            ).unwrap_or(0);

            points.push(TimeSeriesPoint {
                time: label,
                logs,
                alerts,
            });
        }

        Ok(points)
    }

    /// Purge les anciens logs et alertes au-delà de `older_than_days` avec archivage optionnel
    pub fn purge_logs(&self, older_than_days: u32, archive: bool, archive_dir: &str) -> Result<PurgeResult, AppError> {
        let conn = self.conn.lock();
        let cutoff = chrono::Utc::now() - chrono::Duration::days(older_than_days as i64);
        let cutoff_iso = cutoff.to_rfc3339();
        let cutoff_alt = cutoff.format("%Y-%m-%d %H:%M:%S").to_string();

        let mut archive_file_path = None;

        if archive {
            let _ = std::fs::create_dir_all(archive_dir);
            let timestamp_now = chrono::Utc::now().format("%Y%m%d_%H%M%S");
            let file_name = format!("{}/defudolog_archive_{}.json", archive_dir, timestamp_now);

            // Récupérer les logs à archiver
            let mut stmt = conn.prepare(
                "SELECT id, source_id, hostname, raw_message, timestamp FROM raw_logs WHERE timestamp < ?1 OR timestamp < ?2"
            )?;
            let logs_to_archive: Vec<serde_json::Value> = stmt.query_map(params![cutoff_iso, cutoff_alt], |r| {
                Ok(serde_json::json!({
                    "id": r.get::<_, String>(0)?,
                    "source_id": r.get::<_, String>(1)?,
                    "hostname": r.get::<_, String>(2)?,
                    "raw_message": r.get::<_, String>(3)?,
                    "timestamp": r.get::<_, String>(4)?,
                }))
            })?.filter_map(|r| r.ok()).collect();

            if !logs_to_archive.is_empty() {
                if let Ok(json_str) = serde_json::to_string_pretty(&logs_to_archive) {
                    if std::fs::write(&file_name, json_str).is_ok() {
                        archive_file_path = Some(file_name);
                    }
                }
            }
        }

        let purged_logs: u64 = conn.execute(
            "DELETE FROM raw_logs WHERE timestamp < ?1 OR timestamp < ?2",
            params![cutoff_iso, cutoff_alt],
        )? as u64;

        let purged_alerts: u64 = conn.execute(
            "DELETE FROM alerts WHERE detected_at < ?1 OR detected_at < ?2",
            params![cutoff_iso, cutoff_alt],
        )? as u64;

        // Optimiser SQLite après purge massive
        let _ = conn.execute("PRAGMA optimize", []);

        let message = format!(
            "Purge terminée : {} logs et {} alertes supprimés (antérieurs à {} jours).",
            purged_logs, purged_alerts, older_than_days
        );

        Ok(PurgeResult {
            purged_logs,
            purged_alerts,
            archive_file: archive_file_path,
            message,
        })
    }

    // ─── Settings ───────────────────────────────────────

    pub fn get_settings(&self) -> Result<AppSettings, AppError> {
        let conn = self.conn.lock();
        let value: String = conn.query_row(
            "SELECT value FROM app_settings WHERE key = 'main'",
            [],
            |row| row.get(0),
        )?;
        Ok(serde_json::from_str(&value).unwrap_or_default())
    }

    pub fn save_settings(&self, settings: &AppSettings) -> Result<(), AppError> {
        let conn = self.conn.lock();
        let json = serde_json::to_string(settings)?;
        conn.execute(
            "INSERT OR REPLACE INTO app_settings (key, value) VALUES ('main', ?1)",
            params![json],
        )?;
        Ok(())
    }

    // ─── Rules ──────────────────────────────────────────

    pub fn get_rules(&self) -> Result<Vec<DetectionRule>, AppError> {
        let conn = self.conn.lock();
        let mut stmt = conn.prepare(
            "SELECT id, name, description, rule_type, pattern, severity, enabled, created_at
             FROM detection_rules ORDER BY created_at DESC"
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(DetectionRule {
                id: row.get(0)?,
                name: row.get(1)?,
                description: row.get(2)?,
                rule_type: serde_json::from_str(&format!("\"{}\"", row.get::<_, String>(3)?)).unwrap_or(RuleType::Keyword),
                pattern: row.get(4)?,
                severity: parse_alert_level(&row.get::<_, String>(5)?),
                enabled: row.get::<_, i32>(6)? != 0,
                created_at: parse_datetime(&row.get::<_, String>(7)?),
            })
        })?;
        rows.filter_map(|r| r.ok()).collect::<Vec<_>>().into_iter().map(Ok).collect()
    }

    pub fn upsert_rule(&self, rule: &DetectionRule) -> Result<(), AppError> {
        let conn = self.conn.lock();
        conn.execute(
            "INSERT OR REPLACE INTO detection_rules (id, name, description, rule_type, pattern, severity, enabled, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                rule.id,
                rule.name,
                rule.description,
                serde_json::to_string(&rule.rule_type)?.trim_matches('"'),
                rule.pattern,
                rule.severity.to_string(),
                rule.enabled as i32,
                rule.created_at.to_rfc3339(),
            ],
        )?;
        Ok(())
    }

    pub fn delete_rule(&self, id: &str) -> Result<(), AppError> {
        let conn = self.conn.lock();
        conn.execute("DELETE FROM detection_rules WHERE id = ?1", params![id])?;
        Ok(())
    }

    pub fn update_rule_enabled(&self, id: &str, enabled: bool) -> Result<(), AppError> {
        let conn = self.conn.lock();
        conn.execute(
            "UPDATE detection_rules SET enabled = ?1 WHERE id = ?2",
            params![enabled as i32, id],
        )?;
        Ok(())
    }

    // ─── Parsed Logs ────────────────────────────────────

    pub fn insert_parsed_log(
        &self,
        id: &str,
        raw_log_id: &str,
        raw_message: &str,
        template: &str,
        template_id: u64,
        parameters_json: &str,
    ) -> Result<(), AppError> {
        let conn = self.conn.lock();
        conn.execute(
            "INSERT OR REPLACE INTO parsed_logs (id, raw_log_id, raw_message, template, template_id, parameters, parsed_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, datetime('now'))",
            params![id, raw_log_id, raw_message, template, template_id as i64, parameters_json],
        )?;

        // Update template frequencies
        conn.execute(
            "INSERT INTO template_frequencies (template, template_id, count, alert_count, last_seen)
             VALUES (?1, ?2, 1, 0, datetime('now'))
             ON CONFLICT(template_id) DO UPDATE SET
               count = count + 1,
               last_seen = datetime('now')",
            params![template, template_id as i64],
        )?;
        Ok(())
    }

    pub fn get_template_count(&self, template: &str) -> Result<u64, AppError> {
        let conn = self.conn.lock();
        let count: u64 = conn.query_row(
            "SELECT COALESCE(MAX(count), 0) FROM template_frequencies WHERE template = ?1",
            params![template],
            |row| row.get(0),
        )?;
        Ok(count)
    }

    pub fn get_enabled_sources(&self) -> Result<Vec<LogSource>, AppError> {
        self.get_log_sources().map(|sources| {
            sources.into_iter().filter(|s| s.enabled).collect()
        })
    }
}

// ─── Helpers ────────────────────────────────────────────

fn parse_datetime(s: &str) -> chrono::DateTime<chrono::Utc> {
    chrono::DateTime::parse_from_rfc3339(s)
        .map(|dt| dt.with_timezone(&chrono::Utc))
        .or_else(|_| {
            chrono::NaiveDateTime::parse_from_str(s, "%Y-%m-%d %H:%M:%S")
                .map(|nd| nd.and_utc())
        })
        .unwrap_or_else(|_| chrono::Utc::now())
}

fn parse_alert_level(s: &str) -> AlertLevel {
    match s {
        "high" => AlertLevel::High,
        "moderate" => AlertLevel::Moderate,
        "low" => AlertLevel::Low,
        _ => AlertLevel::Benign,
    }
}

fn parse_alert_category(s: &str) -> AlertCategory {
    match s {
        "data_leak" => AlertCategory::DataLeak,
        "authentication" => AlertCategory::Authentication,
        "system_anomaly" => AlertCategory::SystemAnomaly,
        "privilege_escalation" => AlertCategory::PrivilegeEscalation,
        _ => AlertCategory::General,
    }
}
