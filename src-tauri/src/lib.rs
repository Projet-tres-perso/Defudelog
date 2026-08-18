pub mod models;
pub mod db;
pub mod error;
pub mod collector;
pub mod engine;
pub mod syslog_listener;
pub mod siem_exporter;
pub mod webhook_notifier;
pub mod active_response;
pub mod commands;
pub mod network;

use db::Database;
use engine::DetectionPipeline;
use syslog_listener::SyslogServer;
use parking_lot::Mutex;
use std::sync::Arc;
use tauri::Manager;
use tauri::menu::{MenuBuilder, MenuItemBuilder};
use tauri::tray::TrayIconBuilder;

pub struct AppState {
    pub db: Arc<Database>,
    pub engine: Arc<Mutex<DetectionPipeline>>,
    pub settings: Arc<Mutex<models::AppSettings>>,
    pub syslog_server: Arc<SyslogServer>,
    pub collector: Arc<Mutex<collector::LogCollector>>,
    pub network_sniffer: Arc<network::NetworkSniffer>,
}

impl AppState {
    pub fn new(db_path: &str, app_handle: tauri::AppHandle) -> Result<Self, Box<dyn std::error::Error>> {
        let db = Arc::new(Database::new(db_path)?);
        let settings = models::AppSettings::default();
        let engine = Arc::new(Mutex::new(DetectionPipeline::new(db.clone(), settings.detection.clone(), app_handle.clone())));
        let syslog_server = Arc::new(SyslogServer::new(db.clone(), Some(engine.clone()), 1514));
        
        let collector = Arc::new(Mutex::new(collector::LogCollector::new(
            db.clone(),
            Some(engine.clone()),
            Some(app_handle.clone()),
        )));
        let network_sniffer = Arc::new(network::NetworkSniffer::new(db.clone(), app_handle.clone()));
        network_sniffer.start();

        Ok(Self {
            db,
            engine,
            settings: Arc::new(Mutex::new(settings)),
            syslog_server,
            collector,
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

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                // Maintenir le processus en tâche de fond dans la zone de notification (Systray)
                let _ = window.hide();
                api.prevent_close();
            }
        })
        .setup(move |app| {
            let app_handle = app.handle().clone();
            let app_state = AppState::new(&db_path, app_handle).expect("Failed to initialize application state");
            app.manage(app_state);

            // Configuration du System Tray (Zone de notification)
            let show_i = MenuItemBuilder::with_id("show", "Ouvrir DeFuDoLog").build(app)?;
            let status_i = MenuItemBuilder::with_id("status", "Protection & Surveillance Active").enabled(false).build(app)?;
            let quit_i = MenuItemBuilder::with_id("quit", "Quitter Définitivement").build(app)?;
            let menu = MenuBuilder::new(app).items(&[&show_i, &status_i, &quit_i]).build()?;

            let _tray = TrayIconBuilder::new()
                .menu(&menu)
                .tooltip("DeFuDoLog — Surveillance et Détection DLP en Tâche de Fond")
                .on_menu_event(move |app, event| {
                    match event.id().as_ref() {
                        "show" => {
                            if let Some(window) = app.get_webview_window("main") {
                                let _ = window.show();
                                let _ = window.set_focus();
                            }
                        }
                        "quit" => {
                            app.exit(0);
                        }
                        _ => {}
                    }
                })
                .on_tray_icon_event(|tray, event| {
                    if let tauri::tray::TrayIconEvent::Click { button: tauri::tray::MouseButton::Left, .. } = event {
                        let app = tray.app_handle();
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                })
                .build(app)?;

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::add_log_source,
            commands::list_log_sources,
            commands::toggle_log_source,
            commands::delete_log_source,
            commands::auto_discover_host_sources,
            commands::check_source_permission,
            commands::get_network_nodes,
            commands::start_syslog_server,
            commands::stop_syslog_server,
            commands::get_syslog_status,
            commands::start_monitoring,
            commands::stop_monitoring,
            commands::get_monitoring_status,
            commands::check_is_admin,
            commands::relaunch_as_admin,
            commands::purge_demo_sources,
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
            commands::test_llm_connection,
            commands::test_soar_script,
        ])
        .run(tauri::generate_context!())
        .expect("error while running DeFuDoLog");
}
