use pnet::datalink::{self, NetworkInterface};
use pnet::packet::ethernet::{EtherTypes, EthernetPacket};
use pnet::packet::ipv4::Ipv4Packet;
use pnet::packet::tcp::TcpPacket;
use pnet::packet::udp::UdpPacket;
use pnet::packet::Packet;
use std::sync::Arc;
use std::thread;

use crate::db::Database;
use chrono::Utc;
use sha2::{Digest, Sha256};
use uuid::Uuid;

pub struct NetworkSniffer {
    db: Arc<Database>,
}

impl NetworkSniffer {
    pub fn new(db: Arc<Database>) -> Self {
        Self { db }
    }

    pub fn start(&self) {
        let db = self.db.clone();
        
        thread::spawn(move || {
            let interfaces = datalink::interfaces();
            
            let interface = interfaces
                .into_iter()
                .find(|iface| iface.is_up() && !iface.is_loopback() && !iface.ips.is_empty());
                
            if let Some(interface) = interface {
                log::info!("Démarrage de la capture réseau sur {}", interface.name);
                
                match datalink::channel(&interface, Default::default()) {
                    Ok(datalink::Channel::Ethernet(_, mut rx)) => {
                        loop {
                            match rx.next() {
                                Ok(packet) => {
                                    let packet = EthernetPacket::new(packet).unwrap();
                                    Self::handle_packet(&db, &interface, &packet);
                                }
                                Err(e) => {
                                    log::debug!("Erreur de lecture réseau: {}", e);
                                }
                            }
                        }
                    }
                    Ok(_) => log::error!("Type de canal non supporté"),
                    Err(e) => {
                        log::warn!("Erreur de capture réseau (Privilèges administrateur requis?): {}", e);
                    }
                }
            } else {
                log::warn!("Aucune interface réseau appropriée trouvée pour la capture.");
            }
        });
    }

    fn handle_packet(db: &Database, _interface: &NetworkInterface, ethernet: &EthernetPacket) {
        match ethernet.get_ethertype() {
            EtherTypes::Ipv4 => {
                if let Some(ipv4) = Ipv4Packet::new(ethernet.payload()) {
                    let source = ipv4.get_source();
                    let dest = ipv4.get_destination();
                    let mut src_port = 0;
                    let mut dest_port = 0;
                    let mut protocol = "IPv4";

                    match ipv4.get_next_level_protocol() {
                        pnet::packet::ip::IpNextHeaderProtocols::Tcp => {
                            if let Some(tcp) = TcpPacket::new(ipv4.payload()) {
                                src_port = tcp.get_source();
                                dest_port = tcp.get_destination();
                                protocol = "TCP";
                            }
                        }
                        pnet::packet::ip::IpNextHeaderProtocols::Udp => {
                            if let Some(udp) = UdpPacket::new(ipv4.payload()) {
                                src_port = udp.get_source();
                                dest_port = udp.get_destination();
                                protocol = "UDP";
                            }
                        }
                        _ => {}
                    }

                    if src_port != 0 && dest_port != 0 {
                        if rand::random::<u16>() % 100 == 0 { // Sample 1% 
                            let log_str = format!("[NETWORK] {} {} -> {}:{} bytes={}", protocol, source, dest, dest_port, ipv4.get_total_length());
                            
                            let log_hash = {
                                let mut hasher = Sha256::new();
                                hasher.update(log_str.as_bytes());
                                format!("{:x}", hasher.finalize())
                            };

                            let raw_log = crate::models::RawLog {
                                id: Uuid::new_v4().to_string(),
                                source_id: "network_capture".to_string(),
                                hostname: "localhost".to_string(),
                                raw_message: log_str,
                                log_hash,
                                timestamp: Utc::now(),
                                ingested_at: Utc::now(),
                            };

                            let _ = db.insert_raw_log(&raw_log);
                        }
                    }
                }
            }
            _ => {} 
        }
    }
}
