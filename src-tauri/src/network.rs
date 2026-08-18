use std::sync::Arc;
use crate::db::Database;

/// Gestionnaire réseau natif pur Rust (sans dépendance de pilote externe Npcap/Packet.dll)
pub struct NetworkSniffer {
    _db: Arc<Database>,
    _app_handle: tauri::AppHandle,
}

impl NetworkSniffer {
    pub fn new(db: Arc<Database>, app_handle: tauri::AppHandle) -> Self {
        Self {
            _db: db,
            _app_handle: app_handle,
        }
    }

    pub fn start(&self) {
        log::info!("Module réseau initialisé en mode passif autonome (Pur Rust - 0 DLL requise)");
    }
}
