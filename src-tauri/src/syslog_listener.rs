use chrono::Utc;
use sha2::{Digest, Sha256};
use std::net::SocketAddr;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tokio::net::{TcpListener, UdpSocket};
use tokio::io::AsyncBufReadExt;
use uuid::Uuid;
use crate::db::Database;
use crate::models::RawLog;
use parking_lot::Mutex;
use crate::engine::DetectionPipeline;

/// Serveur Syslog réseau (UDP/TCP)
pub struct SyslogServer {
    db: Arc<Database>,
    engine: Option<Arc<Mutex<DetectionPipeline>>>,
    running: Arc<AtomicBool>,
    port: u16,
}

impl SyslogServer {
    pub fn new(db: Arc<Database>, engine: Option<Arc<Mutex<DetectionPipeline>>>, port: u16) -> Self {
        Self {
            db,
            engine,
            running: Arc::new(AtomicBool::new(false)),
            port,
        }
    }

    pub fn is_running(&self) -> bool {
        self.running.load(Ordering::SeqCst)
    }

    pub fn stop(&self) {
        self.running.store(false, Ordering::SeqCst);
    }

    /// Démarre les écouteurs UDP et TCP
    pub async fn start(&self) -> Result<(), String> {
        if self.is_running() {
            return Ok(());
        }

        self.running.store(true, Ordering::SeqCst);
        let port = self.port;
        let db_udp = self.db.clone();
        let db_tcp = self.db.clone();
        let engine_udp = self.engine.clone();
        let engine_tcp = self.engine.clone();
        let running_udp = self.running.clone();
        let running_tcp = self.running.clone();

        // 1. Écouteur UDP
        tokio::spawn(async move {
            let addr = format!("0.0.0.0:{}", port);
            if let Ok(socket) = UdpSocket::bind(&addr).await {
                log::info!("Serveur Syslog UDP démarré sur {}", addr);
                let mut buf = [0u8; 4096];

                while running_udp.load(Ordering::SeqCst) {
                    tokio::select! {
                        res = socket.recv_from(&mut buf) => {
                            match res {
                                Ok((len, peer)) => {
                                    let msg = String::from_utf8_lossy(&buf[..len]).to_string();
                                    Self::process_syslog_msg(&db_udp, engine_udp.as_ref(), peer, &msg);
                                }
                                Err(e) => {
                                    log::error!("Erreur récepteur Syslog UDP: {}", e);
                                }
                            }
                        }
                        _ = tokio::time::sleep(tokio::time::Duration::from_millis(200)) => {}
                    }
                }
            } else {
                log::error!("Impossible de lier le socket UDP Syslog sur {}", addr);
            }
        });

        // 2. Écouteur TCP
        tokio::spawn(async move {
            let addr = format!("0.0.0.0:{}", port);
            if let Ok(listener) = TcpListener::bind(&addr).await {
                log::info!("Serveur Syslog TCP démarré sur {}", addr);

                while running_tcp.load(Ordering::SeqCst) {
                    tokio::select! {
                        res = listener.accept() => {
                            if let Ok((stream, peer)) = res {
                                let db_conn = db_tcp.clone();
                                let eng_conn = engine_tcp.clone();
                                tokio::spawn(async move {
                                    let reader = tokio::io::BufReader::new(stream);
                                    let mut lines = reader.lines();
                                    while let Ok(Some(line)) = lines.next_line().await {
                                        if !line.trim().is_empty() {
                                            Self::process_syslog_msg(&db_conn, eng_conn.as_ref(), peer, &line);
                                        }
                                    }
                                });
                            }
                        }
                        _ = tokio::time::sleep(tokio::time::Duration::from_millis(200)) => {}
                    }
                }
            } else {
                log::error!("Impossible de lier le socket TCP Syslog sur {}", addr);
            }
        });

        Ok(())
    }

    /// Traite un message Syslog brut, enregistre le nœud réseau LAN et l'injecte dans le pipeline
    fn process_syslog_msg(
        db: &Database,
        engine: Option<&Arc<Mutex<DetectionPipeline>>>,
        peer: SocketAddr,
        raw: &str,
    ) {
        let (hostname, message) = Self::parse_syslog_line(peer, raw);
        let source_id = format!("network_syslog_{}", peer.ip());

        // 1. Découverte automatique du nœud réseau : l'ajouter dans log_sources
        if let Err(e) = db.insert_or_ignore_network_source(&source_id, &hostname, &peer.ip().to_string()) {
            log::warn!("Erreur enregistrement source réseau LAN: {}", e);
        }

        let log_hash = {
            let mut hasher = Sha256::new();
            hasher.update(message.as_bytes());
            format!("{:x}", hasher.finalize())
        };

        let raw_log = RawLog {
            id: Uuid::new_v4().to_string(),
            source_id: source_id.clone(),
            hostname: hostname.clone(),
            raw_message: message.clone(),
            log_hash,
            meaning: None,
            timestamp: Utc::now(),
            ingested_at: Utc::now(),
        };

        if let Err(e) = db.insert_raw_log(&raw_log) {
            log::error!("Erreur insertion log Syslog réseau: {}", e);
        }

        // 2. Traitement immédiat par le moteur d'analyse multi-axes
        if let Some(engine_lock) = engine {
            let mut eng = engine_lock.lock();
            let _ = eng.process_log(&source_id, &hostname, &message, Utc::now());
        }
    }

    /// Parse une ligne Syslog RFC 3164 / 5424 pour extraire le nom d'hôte et le message
    pub fn parse_syslog_line(peer: SocketAddr, raw: &str) -> (String, String) {
        let trimmed = raw.trim();
        
        // Retirer le header PRI de type <34> ou <13>
        let content = if trimmed.starts_with('<') {
            if let Some(pos) = trimmed.find('>') {
                &trimmed[pos + 1..]
            } else {
                trimmed
            }
        } else {
            trimmed
        };

        // Format RFC 3164: "Mmm dd hh:mm:ss hostname message"
        let parts: Vec<&str> = content.split_whitespace().collect();
        if parts.len() >= 4 {
            let hostname = parts[3].to_string();
            let msg = parts[4..].join(" ");
            if !msg.is_empty() {
                return (hostname, msg);
            }
        }

        // Par défaut: nom de la machine = IP source, message = contenu complet
        (peer.ip().to_string(), content.to_string())
    }
}
