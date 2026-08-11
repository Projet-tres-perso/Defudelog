mod models;
mod db;
mod error;
mod collector;
mod engine;
mod syslog_listener;
mod siem_exporter;
mod webhook_notifier;
mod active_response;
mod commands;
mod network;

use db::Database;
use engine::DetectionPipeline;
use syslog_listener::SyslogServer;
use parking_lot::Mutex;
use std::sync::Arc;

pub struct AppState {
    pub db: Arc<Database>,
    pub engine: Arc<Mutex<DetectionPipeline>>,
    pub settings: Arc<Mutex<models::AppSettings>>,
    pub syslog_server: Arc<SyslogServer>,
    pub collector: Arc<Mutex<collector::LogCollector>>,
    pub network_sniffer: Arc<network::NetworkSniffer>,
}

impl AppState {
    pub fn new(db_path: &str) -> Result<Self, Box<dyn std::error::Error>> {
        let db = Arc::new(Database::new(db_path)?);
        let settings = models::AppSettings::default();
        let engine = DetectionPipeline::new(db.clone(), settings.detection.clone());
        let syslog_server = Arc::new(SyslogServer::new(db.clone(), 1514));
        
        let mut collector = collector::LogCollector::new(db.clone());
        if let Err(e) = collector.start() {
            log::error!("Erreur au démarrage du LogCollector: {}", e);
        }

        let network_sniffer = Arc::new(network::NetworkSniffer::new(db.clone()));
        network_sniffer.start();

        Ok(Self {
            db,
            engine: Arc::new(Mutex::new(engine)),
            settings: Arc::new(Mutex::new(settings)),
            syslog_server,
            collector: Arc::new(Mutex::new(collector)),
            network_sniffer,
        })
    }
}

fn get_db_path() -> String {
    if let Some(mut path) = dirs::data_dir() {
        path.push("defudolog");
        let _ = std::fs::create_dir_all(&path);
        path.push("defudolog.db");
        path.to_string_lossy().to_string()
    } else {
        "defudolog_app.db".to_string()
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info"))
        .format_timestamp_millis()
        .init();

    let db_path = get_db_path();
    log::info!("Base de données SQLite initialisée dans: {}", db_path);

    let app_state = AppState::new(&db_path)
        .expect("Failed to initialize application state");

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .manage(app_state)
        .invoke_handler(tauri::generate_handler![
            commands::add_log_source,
            commands::list_log_sources,
            commands::toggle_log_source,
            commands::delete_log_source,
            commands::auto_discover_host_sources,
            commands::get_network_nodes,
            commands::start_syslog_server,
            commands::stop_syslog_server,
            commands::get_syslog_status,
            commands::get_raw_logs,
            commands::get_alerts,
            commands::acknowledge_alert,
            commands::dismiss_alert,
            commands::get_dashboard_stats,
            commands::get_template_stats,
            commands::get_timeseries_stats,
            commands::run_detection,
            commands::run_detection_on_range,
            commands::add_detection_rule,
            commands::list_rules,
            commands::toggle_rule,
            commands::delete_rule,
            commands::get_settings,
            commands::update_settings,
            commands::get_log_context,
            commands::get_templates,
            commands::generate_demo_logs,
            commands::export_alerts_siem,
            commands::test_webhook,
        ])
        .run(tauri::generate_context!())
        .expect("error while running DeFuDoLog");
}
