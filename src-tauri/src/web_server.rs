use std::sync::Arc;
use std::net::SocketAddr;
use tokio::net::TcpListener;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use parking_lot::Mutex;
use crate::db::Database;
use crate::models::LanServerSettings;

pub struct LanWebServer {
    db: Arc<Database>,
    settings: Arc<Mutex<LanServerSettings>>,
    shutdown_tx: Mutex<Option<tokio::sync::broadcast::Sender<()>>>,
    is_running: std::sync::atomic::AtomicBool,
}

impl LanWebServer {
    pub fn new(db: Arc<Database>, settings: LanServerSettings) -> Self {
        Self {
            db,
            settings: Arc::new(Mutex::new(settings)),
            shutdown_tx: Mutex::new(None),
            is_running: std::sync::atomic::AtomicBool::new(false),
        }
    }

    pub fn update_settings(&self, new_settings: LanServerSettings) {
        let mut s = self.settings.lock();
        *s = new_settings;
    }

    pub fn get_settings(&self) -> LanServerSettings {
        self.settings.lock().clone()
    }

    pub fn is_running(&self) -> bool {
        self.is_running.load(std::sync::atomic::Ordering::SeqCst)
    }

    pub fn get_local_ip() -> String {
        // 1. Tenter une résolution UDP vers l'extérieur
        let targets = ["8.8.8.8:80", "1.1.1.1:80", "192.168.1.1:80", "10.0.0.1:80", "172.16.0.1:80"];
        for target in targets {
            if let Ok(socket) = std::net::UdpSocket::bind("0.0.0.0:0") {
                if socket.connect(target).is_ok() {
                    if let Ok(addr) = socket.local_addr() {
                        let ip_str = addr.ip().to_string();
                        if ip_str != "0.0.0.0" && ip_str != "127.0.0.1" {
                            return ip_str;
                        }
                    }
                }
            }
        }

        // 2. Fallback hostname local
        "127.0.0.1".to_string()
    }

    pub async fn start(&self) -> Result<String, String> {
        if self.is_running() {
            let port = self.settings.lock().port;
            let ip = Self::get_local_ip();
            return Ok(format!("http://{}:{}", ip, port));
        }

        let port = self.settings.lock().port;
        let addr = SocketAddr::from(([0, 0, 0, 0], port));
        
        let listener = TcpListener::bind(addr).await
            .map_err(|e| format!("Impossible d'ouvrir le port {} : {}", port, e))?;

        let (shutdown_tx, mut shutdown_rx) = tokio::sync::broadcast::channel(1);
        {
            let mut tx_lock = self.shutdown_tx.lock();
            *tx_lock = Some(shutdown_tx);
        }

        self.is_running.store(true, std::sync::atomic::Ordering::SeqCst);
        let db = self.db.clone();
        let settings = self.settings.clone();
        let local_ip = Self::get_local_ip();
        let url = format!("http://{}:{}", local_ip, port);

        log::info!("🌐 Serveur Web LAN DefuDelog démarré sur {}", url);

        tokio::spawn(async move {
            loop {
                tokio::select! {
                    accept_res = listener.accept() => {
                        match accept_res {
                            Ok((mut socket, peer_addr)) => {
                                let db_clone = db.clone();
                                let settings_clone = settings.clone();
                                tokio::spawn(async move {
                                    handle_http_client(&mut socket, peer_addr, db_clone, settings_clone).await;
                                });
                            }
                            Err(e) => {
                                log::error!("Erreur accept client LAN: {}", e);
                            }
                        }
                    }
                    _ = shutdown_rx.recv() => {
                        log::info!("Serveur Web LAN arrêté.");
                        break;
                    }
                }
            }
        });

        Ok(url)
    }

    pub fn stop(&self) {
        if let Some(tx) = self.shutdown_tx.lock().take() {
            let _ = tx.send(());
        }
        self.is_running.store(false, std::sync::atomic::Ordering::SeqCst);
    }
}

async fn handle_http_client(
    socket: &mut tokio::net::TcpStream,
    _peer_addr: SocketAddr,
    db: Arc<Database>,
    settings: Arc<Mutex<LanServerSettings>>,
) {
    let mut buffer = Vec::with_capacity(8192);
    let mut temp = [0u8; 4096];

    // Lecture complète de l'en-tête HTTP
    loop {
        match socket.read(&mut temp).await {
            Ok(n) if n > 0 => {
                buffer.extend_from_slice(&temp[..n]);
                if buffer.windows(4).any(|w| w == b"\r\n\r\n") || buffer.len() > 65536 {
                    break;
                }
            }
            _ => break,
        }
    }

    if buffer.is_empty() {
        return;
    }

    let req_str = String::from_utf8_lossy(&buffer);
    let first_line = req_str.lines().next().unwrap_or("");
    let parts: Vec<&str> = first_line.split_whitespace().collect();

    if parts.len() < 2 {
        return;
    }

    let method = parts[0];
    let full_path = parts[1];
    let (path, _query) = full_path.split_once('?').unwrap_or((full_path, ""));

    // Récupérer le header Authorization
    let auth_header = req_str.lines()
        .find(|l| l.to_lowercase().starts_with("authorization:"))
        .map(|l| l.split_once(':').unwrap_or(("", "")).1.trim().to_string());

    // Vérifier les tokens d'authentification
    let (is_auth, user_role, allowed_views) = {
        let s = settings.lock();
        if let Some(token) = &auth_header {
            let clean_token = token.trim_start_matches("Bearer ").trim();
            if clean_token == s.admin_access_key {
                (true, "admin".to_string(), vec!["dashboard".to_string(), "logs".to_string(), "alerts".to_string(), "rules".to_string(), "network".to_string()])
            } else if clean_token == s.user_access_key {
                let views = s.user_allowed_views.clone();
                (true, "user".to_string(), views)
            } else {
                (false, "guest".to_string(), vec![])
            }
        } else {
            (false, "guest".to_string(), vec![])
        }
    };

    // Routing
    let (status_code, content_type, body) = match (method, path) {
        ("OPTIONS", _) => {
            ("204 No Content", "text/plain", "".to_string())
        }
        ("POST", "/api/auth/login") => {
            let body_part = req_str.split("\r\n\r\n").nth(1).unwrap_or("");
            let parsed: Result<serde_json::Value, _> = serde_json::from_str(body_part.trim());
            let s = settings.lock();

            if let Ok(json) = parsed {
                let username = json["username"].as_str().unwrap_or("").trim();
                let key = json["access_key"].as_str().unwrap_or("").trim().to_uppercase();

                if username == s.admin_username && key == s.admin_access_key.to_uppercase() {
                    let resp = serde_json::json!({
                        "ok": true,
                        "role": "admin",
                        "username": username,
                        "token": s.admin_access_key,
                        "allowed_views": ["dashboard", "logs", "alerts", "rules", "network"]
                    });
                    ("200 OK", "application/json", resp.to_string())
                } else if username == s.user_username && key == s.user_access_key.to_uppercase() {
                    let resp = serde_json::json!({
                        "ok": true,
                        "role": "user",
                        "username": username,
                        "token": s.user_access_key,
                        "allowed_views": s.user_allowed_views
                    });
                    ("200 OK", "application/json", resp.to_string())
                } else {
                    let resp = serde_json::json!({
                        "ok": false,
                        "message": "Identifiant ou clé d'accès à 7 caractères invalide."
                    });
                    ("401 Unauthorized", "application/json", resp.to_string())
                }
            } else {
                ("400 Bad Request", "application/json", r#"{"error":"Requête JSON invalide"}"#.to_string())
            }
        }
        ("GET", "/api/stats") => {
            if !is_auth || (!allowed_views.iter().any(|v| v == "dashboard") && user_role != "admin") {
                ("403 Forbidden", "application/json", r#"{"error":"Accès refusé"}"#.to_string())
            } else {
                match db.get_dashboard_stats() {
                    Ok(stats) => ("200 OK", "application/json", serde_json::to_string(&stats).unwrap_or_default()),
                    Err(e) => ("500 Internal Server Error", "application/json", format!(r#"{{"error":"{}"}}"#, e)),
                }
            }
        }
        ("GET", "/api/timeseries") => {
            if !is_auth || (!allowed_views.iter().any(|v| v == "dashboard") && user_role != "admin") {
                ("403 Forbidden", "application/json", r#"{"error":"Accès refusé"}"#.to_string())
            } else {
                match db.get_timeseries_stats() {
                    Ok(ts) => ("200 OK", "application/json", serde_json::to_string(&ts).unwrap_or_default()),
                    Err(e) => ("500 Internal Server Error", "application/json", format!(r#"{{"error":"{}"}}"#, e)),
                }
            }
        }
        ("GET", "/api/logs") => {
            if !is_auth || (!allowed_views.iter().any(|v| v == "logs") && user_role != "admin") {
                ("403 Forbidden", "application/json", r#"{"error":"Accès refusé"}"#.to_string())
            } else {
                match db.get_raw_logs(50, 0, None, None) {
                    Ok((logs, total)) => {
                        let resp = serde_json::json!({ "logs": logs, "total": total });
                        ("200 OK", "application/json", resp.to_string())
                    }
                    Err(e) => ("500 Internal Server Error", "application/json", format!(r#"{{"error":"{}"}}"#, e)),
                }
            }
        }
        ("GET", "/api/alerts") => {
            if !is_auth || (!allowed_views.iter().any(|v| v == "alerts") && user_role != "admin") {
                ("403 Forbidden", "application/json", r#"{"error":"Accès refusé"}"#.to_string())
            } else {
                match db.get_alerts(None, None, 30, 0) {
                    Ok((alerts, total)) => {
                        let resp = serde_json::json!({ "alerts": alerts, "total": total });
                        ("200 OK", "application/json", resp.to_string())
                    }
                    Err(e) => ("500 Internal Server Error", "application/json", format!(r#"{{"error":"{}"}}"#, e)),
                }
            }
        }
        ("GET", "/api/network") => {
            if !is_auth || (!allowed_views.iter().any(|v| v == "network") && user_role != "admin") {
                ("403 Forbidden", "application/json", r#"{"error":"Accès refusé"}"#.to_string())
            } else {
                match db.get_network_nodes() {
                    Ok(nodes) => ("200 OK", "application/json", serde_json::to_string(&nodes).unwrap_or_default()),
                    Err(e) => ("500 Internal Server Error", "application/json", format!(r#"{{"error":"{}"}}"#, e)),
                }
            }
        }
        ("GET", "/" | "/index.html") => {
            ("200 OK", "text/html; charset=utf-8", get_embedded_web_app_html())
        }
        _ => {
            ("404 Not Found", "text/plain", "Page introuvable".to_string())
        }
    };

    let response = format!(
        "HTTP/1.1 {}\r\n\
         Content-Type: {}\r\n\
         Content-Length: {}\r\n\
         Access-Control-Allow-Origin: *\r\n\
         Access-Control-Allow-Methods: GET, POST, OPTIONS\r\n\
         Access-Control-Allow-Headers: Authorization, Content-Type, Accept, Origin\r\n\
         Connection: close\r\n\r\n\
         {}",
        status_code,
        content_type,
        body.len(),
        body
    );

    let _ = socket.write_all(response.as_bytes()).await;
}

/// Interface Web HTML5/CSS3 autonome embarquée 100% hors-ligne (sans dépendance CDN externe)
fn get_embedded_web_app_html() -> String {
    r##"<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>DefuDelog — Console Web LAN</title>
  <style>
    :root {
      --bg: #090d16;
      --card-bg: rgba(15, 23, 42, 0.75);
      --border: rgba(51, 65, 85, 0.6);
      --text: #f8fafc;
      --text-muted: #94a3b8;
      --blue: #3b82f6;
      --blue-hover: #2563eb;
      --emerald: #10b981;
      --amber: #f59e0b;
      --red: #ef4444;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background-color: var(--bg);
      color: var(--text);
      font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
    }
    header {
      background: rgba(10, 15, 29, 0.9);
      backdrop-filter: blur(12px);
      border-bottom: 1px solid var(--border);
      padding: 1rem 1.5rem;
      display: flex;
      align-items: center;
      justify-content: space-between;
      position: sticky;
      top: 0;
      z-index: 50;
    }
    .logo-badge {
      background: linear-gradient(135deg, #2563eb, #3b82f6);
      width: 36px;
      height: 36px;
      border-radius: 10px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 800;
      font-size: 14px;
      color: #fff;
      box-shadow: 0 4px 12px rgba(37, 99, 235, 0.35);
    }
    .glass {
      background: var(--card-bg);
      backdrop-filter: blur(16px);
      border: 1px solid var(--border);
      border-radius: 1rem;
    }
    .glow { box-shadow: 0 0 35px -5px rgba(37, 99, 235, 0.3); }
    .btn {
      background: var(--blue);
      color: #fff;
      border: none;
      padding: 0.65rem 1.25rem;
      border-radius: 0.5rem;
      font-weight: 600;
      font-size: 0.875rem;
      cursor: pointer;
      transition: all 0.2s;
    }
    .btn:hover { background: var(--blue-hover); transform: translateY(-1px); }
    .input {
      width: 100%;
      background: #0f172a;
      border: 1px solid var(--border);
      color: #fff;
      padding: 0.65rem 0.85rem;
      border-radius: 0.5rem;
      font-size: 0.875rem;
      outline: none;
    }
    .input:focus { border-color: var(--blue); }
    .key-input {
      font-family: monospace;
      letter-spacing: 0.3em;
      text-align: center;
      text-transform: uppercase;
      font-weight: 700;
      color: #60a5fa;
      font-size: 1.1rem;
    }
    .grid-4 { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1rem; }
    .stat-box { padding: 1.25rem; }
    .stat-val { font-size: 1.75rem; font-weight: 700; margin-top: 0.25rem; }
    .badge {
      display: inline-flex;
      align-items: center;
      gap: 0.35rem;
      padding: 0.2rem 0.6rem;
      border-radius: 9999px;
      font-size: 0.75rem;
      font-weight: 600;
    }
    .badge-high { background: rgba(239, 68, 68, 0.15); color: #f87171; border: 1px solid rgba(239, 68, 68, 0.3); }
    .badge-mod { background: rgba(245, 158, 11, 0.15); color: #fbbf24; border: 1px solid rgba(245, 158, 11, 0.3); }
    .badge-ok { background: rgba(16, 185, 129, 0.15); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.3); }
    .hidden { display: none !important; }
    table { width: 100%; border-collapse: collapse; font-family: monospace; font-size: 0.8rem; }
    th, td { padding: 0.65rem 0.75rem; text-align: left; border-bottom: 1px solid rgba(51, 65, 85, 0.4); }
    th { color: var(--text-muted); font-weight: 600; }
    .tab-btn {
      background: rgba(30, 41, 59, 0.6);
      color: var(--text-muted);
      border: 1px solid var(--border);
      padding: 0.45rem 1rem;
      border-radius: 0.5rem;
      font-size: 0.8rem;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s;
    }
    .tab-btn.active {
      background: var(--blue);
      color: #fff;
      border-color: var(--blue);
    }
  </style>
</head>
<body>

  <!-- Header -->
  <header>
    <div style="display: flex; align-items: center; gap: 0.75rem;">
      <div class="logo-badge">DF</div>
      <div>
        <div style="display: flex; align-items: center; gap: 0.5rem;">
          <strong style="font-size: 1.05rem;">DefuDelog</strong>
          <span style="background: rgba(59, 130, 246, 0.15); color: #60a5fa; padding: 0.1rem 0.4rem; border-radius: 4px; font-size: 0.7rem; font-family: monospace;">Console LAN</span>
        </div>
        <div style="font-size: 0.75rem; color: var(--text-muted);">Surveillance & Détection DLP Réseau</div>
      </div>
    </div>
    <div id="user-pill" class="hidden" style="align-items: center; gap: 0.75rem;">
      <span id="role-badge" class="badge badge-ok"></span>
      <button onclick="logout()" style="background: none; border: none; color: var(--text-muted); font-size: 0.75rem; cursor: pointer;">Déconnexion</button>
    </div>
  </header>

  <!-- Login Modal -->
  <div id="login-view" style="flex: 1; display: flex; align-items: center; justify-content: center; padding: 1.5rem;">
    <div class="glass glow" style="max-width: 420px; width: 100%; padding: 2rem;">
      <div style="text-align: center; margin-bottom: 1.5rem;">
        <h2 style="font-size: 1.25rem; font-weight: 700;">Connexion Console Distante</h2>
        <p style="font-size: 0.8rem; color: var(--text-muted); margin-top: 0.35rem;">Identifiant & Clé d'accès à 7 caractères</p>
      </div>
      <form id="login-form" onsubmit="handleLogin(event)" style="display: flex; flex-direction: column; gap: 1rem;">
        <div>
          <label style="display: block; font-size: 0.75rem; margin-bottom: 0.35rem; color: var(--text-muted);">Identifiant (Username)</label>
          <input type="text" id="username" required placeholder="admin_soc ou analyste" class="input">
        </div>
        <div>
          <label style="display: block; font-size: 0.75rem; margin-bottom: 0.35rem; color: var(--text-muted);">Clé d'accès (7 caractères)</label>
          <input type="text" id="access-key" maxlength="7" required placeholder="ex: DF7K9QX" class="input key-input">
        </div>
        <div id="login-error" class="hidden" style="color: #f87171; background: rgba(239, 68, 68, 0.15); padding: 0.65rem; border-radius: 0.5rem; font-size: 0.75rem; border: 1px solid rgba(239, 68, 68, 0.3);"></div>
        <button type="submit" class="btn" style="width: 100%; margin-top: 0.5rem;">Accéder au Dashboard</button>
      </form>
    </div>
  </div>

  <!-- Main App View -->
  <main id="app-view" class="hidden" style="flex: 1; padding: 1.5rem; max-width: 1200px; width: 100%; margin: 0 auto; display: flex; flex-direction: column; gap: 1.25rem;">
    
    <!-- Nav Tabs -->
    <div id="nav-tabs" style="display: flex; gap: 0.5rem; border-bottom: 1px solid var(--border); padding-bottom: 0.75rem;"></div>

    <!-- View: Dashboard -->
    <div id="view-dashboard" style="display: flex; flex-direction: column; gap: 1.25rem;">
      <div class="grid-4">
        <div class="glass stat-box">
          <div style="font-size: 0.75rem; color: var(--text-muted);">Total Logs Ingérés</div>
          <div class="stat-val" id="stat-total-logs">-</div>
        </div>
        <div class="glass stat-box">
          <div style="font-size: 0.75rem; color: var(--text-muted);">Alertes DLP Actives</div>
          <div class="stat-val" style="color: #f87171;" id="stat-alerts">-</div>
        </div>
        <div class="glass stat-box">
          <div style="font-size: 0.75rem; color: var(--text-muted);">Débit Ingestion</div>
          <div class="stat-val" style="color: #60a5fa;" id="stat-eps">- eps</div>
        </div>
        <div class="glass stat-box">
          <div style="font-size: 0.75rem; color: var(--text-muted);">Statut Protection</div>
          <div class="stat-val" style="color: #34d399; font-size: 1.25rem; display: flex; align-items: center; gap: 0.5rem;">
            <span style="display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: #34d399;"></span> Actif (LAN)
          </div>
        </div>
      </div>

      <div class="glass" style="padding: 1.25rem;">
        <h3 style="font-size: 0.9rem; margin-bottom: 0.75rem;">Dernières Alertes Qualifiées</h3>
        <div id="recent-alerts-table" style="display: flex; flex-direction: column; gap: 0.5rem;"></div>
      </div>
    </div>

    <!-- View: Logs -->
    <div id="view-logs" class="hidden glass" style="padding: 1.25rem;">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.75rem;">
        <h3 style="font-size: 0.9rem;">Flux des Logs en Direct</h3>
        <button onclick="fetchLogs()" class="tab-btn">Actualiser</button>
      </div>
      <div style="overflow-x: auto;">
        <table>
          <thead>
            <tr>
              <th>Date/Heure</th>
              <th>Hôte</th>
              <th>Message de log</th>
            </tr>
          </thead>
          <tbody id="logs-tbody"></tbody>
        </table>
      </div>
    </div>

    <!-- View: Alerts -->
    <div id="view-alerts" class="hidden glass" style="padding: 1.25rem;">
      <h3 style="font-size: 0.9rem; margin-bottom: 0.75rem;">Toutes les Alertes DLP & Incidents</h3>
      <div id="all-alerts-list" style="display: flex; flex-direction: column; gap: 0.75rem;"></div>
    </div>

    <!-- View: Network -->
    <div id="view-network" class="hidden glass" style="padding: 1.25rem;">
      <h3 style="font-size: 0.9rem; margin-bottom: 0.75rem;">Nœuds Découverts sur le Réseau</h3>
      <div id="network-nodes-list" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 0.75rem;"></div>
    </div>

  </main>

  <script>
    let currentToken = localStorage.getItem("defudelog_token");
    let currentRole = localStorage.getItem("defudelog_role");
    let currentViews = JSON.parse(localStorage.getItem("defudelog_views") || "[]");

    function renderNav() {
      const tabs = document.getElementById("nav-tabs");
      tabs.innerHTML = "";
      
      const availableTabs = [
        { id: "dashboard", label: "Tableau de Bord" },
        { id: "logs", label: "Flux des Logs" },
        { id: "alerts", label: "Alertes DLP" },
        { id: "network", label: "Découverte Réseau" },
      ];

      availableTabs.forEach((tab, index) => {
        if (currentRole === "admin" || currentViews.includes(tab.id)) {
          const btn = document.createElement("button");
          btn.className = `tab-btn ${index === 0 ? "active" : ""}`;
          btn.textContent = tab.label;
          btn.onclick = () => switchView(tab.id, btn);
          tabs.appendChild(btn);
        }
      });
    }

    function switchView(viewId, activeBtn) {
      ["dashboard", "logs", "alerts", "network"].forEach(id => {
        const el = document.getElementById("view-" + id);
        if (el) el.classList.add("hidden");
      });
      const target = document.getElementById("view-" + viewId);
      if (target) target.classList.remove("hidden");

      if (activeBtn) {
        document.querySelectorAll("#nav-tabs button").forEach(b => b.classList.remove("active"));
        activeBtn.classList.add("active");
      }

      if (viewId === "logs") fetchLogs();
      if (viewId === "alerts") fetchAlerts();
      if (viewId === "network") fetchNetwork();
    }

    async function handleLogin(e) {
      e.preventDefault();
      const username = document.getElementById("username").value.trim();
      const key = document.getElementById("access-key").value.trim().toUpperCase();
      const errEl = document.getElementById("login-error");

      try {
        const res = await fetch("/api/auth/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username, access_key: key })
        });
        const data = await res.json();
        if (data.ok) {
          currentToken = data.token;
          currentRole = data.role;
          currentViews = data.allowed_views;
          localStorage.setItem("defudelog_token", currentToken);
          localStorage.setItem("defudelog_role", currentRole);
          localStorage.setItem("defudelog_views", JSON.stringify(currentViews));
          showApp();
        } else {
          errEl.textContent = data.message || "Échec d'authentification";
          errEl.classList.remove("hidden");
        }
      } catch (err) {
        errEl.textContent = "Erreur de connexion au serveur LAN : " + err.message;
        errEl.classList.remove("hidden");
      }
    }

    function showApp() {
      document.getElementById("login-view").classList.add("hidden");
      document.getElementById("app-view").classList.remove("hidden");
      document.getElementById("user-pill").classList.remove("hidden");
      document.getElementById("user-pill").style.display = "flex";
      
      const badge = document.getElementById("role-badge");
      badge.textContent = currentRole === "admin" ? "Admin (Accès Complet)" : "Analyste (Restreint)";
      
      renderNav();
      fetchDashboard();
      setInterval(fetchDashboard, 3000);
    }

    function logout() {
      localStorage.clear();
      location.reload();
    }

    async function fetchDashboard() {
      if (!currentToken) return;
      try {
        const res = await fetch("/api/stats", { headers: { "Authorization": "Bearer " + currentToken } });
        if (res.status === 401 || res.status === 403) return logout();
        const data = await res.json();
        document.getElementById("stat-total-logs").textContent = (data.total_logs || 0).toLocaleString();
        document.getElementById("stat-alerts").textContent = data.total_alerts || 0;
        document.getElementById("stat-eps").textContent = (data.logs_per_second || 0).toFixed(1) + " eps";

        const alertsRes = await fetch("/api/alerts", { headers: { "Authorization": "Bearer " + currentToken } });
        if (alertsRes.ok) {
          const aData = await alertsRes.json();
          const list = document.getElementById("recent-alerts-table");
          list.innerHTML = (aData.alerts || []).slice(0, 5).map(a => `
            <div style="padding: 0.65rem; background: rgba(15, 23, 42, 0.6); border-radius: 8px; border: 1px solid rgba(51, 65, 85, 0.4); display: flex; justify-content: space-between; align-items: center;">
              <div>
                <span class="badge ${a.level === 'high' ? 'badge-high' : 'badge-mod'}">${a.level}</span>
                <strong style="margin-left: 0.5rem; font-size: 0.8rem;">${a.category}</strong>
                <p style="font-size: 0.75rem; color: var(--text-muted); margin-top: 0.2rem;">${a.template || 'Anomalie détectée'}</p>
              </div>
              <span style="font-size: 0.7rem; color: var(--text-muted);">${new Date(a.detected_at).toLocaleTimeString()}</span>
            </div>
          `).join("") || "<p style='color: var(--text-muted); font-size: 0.75rem;'>Aucune alerte récente.</p>";
        }
      } catch (e) {
        console.error(e);
      }
    }

    async function fetchLogs() {
      if (!currentToken) return;
      try {
        const res = await fetch("/api/logs", { headers: { "Authorization": "Bearer " + currentToken } });
        if (!res.ok) return;
        const data = await res.json();
        const tbody = document.getElementById("logs-tbody");
        tbody.innerHTML = (data.logs || []).map(l => `
          <tr>
            <td style="color: var(--text-muted); white-space: nowrap;">${new Date(l.timestamp).toLocaleTimeString()}</td>
            <td style="color: #60a5fa; white-space: nowrap;">${l.hostname}</td>
            <td style="color: #cbd5e1; word-break: break-all;">${l.raw_message}</td>
          </tr>
        `).join("");
      } catch (e) {
        console.error(e);
      }
    }

    async function fetchAlerts() {
      if (!currentToken) return;
      try {
        const res = await fetch("/api/alerts", { headers: { "Authorization": "Bearer " + currentToken } });
        if (!res.ok) return;
        const data = await res.json();
        const list = document.getElementById("all-alerts-list");
        list.innerHTML = (data.alerts || []).map(a => `
          <div style="padding: 0.85rem; background: rgba(15, 23, 42, 0.6); border-radius: 10px; border: 1px solid rgba(51, 65, 85, 0.4); display: flex; flex-direction: column; gap: 0.35rem;">
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <span class="badge ${a.level === 'high' ? 'badge-high' : 'badge-mod'}">${a.level} — Score: ${(a.final_score * 100).toFixed(0)}%</span>
              <span style="font-size: 0.7rem; color: var(--text-muted);">${new Date(a.detected_at).toLocaleString()}</span>
            </div>
            <strong style="font-size: 0.85rem;">${a.category}: ${a.template}</strong>
            ${a.llm_explanation ? `<p style="font-size: 0.75rem; color: #93c5fd; background: rgba(30, 58, 138, 0.3); padding: 0.5rem; border-radius: 6px; border: 1px solid rgba(30, 58, 138, 0.5);">💡 <strong>Analyse IA :</strong> ${a.llm_explanation}</p>` : ''}
          </div>
        `).join("") || "<p style='color: var(--text-muted); font-size: 0.75rem;'>Aucune alerte enregistrée.</p>";
      } catch (e) {
        console.error(e);
      }
    }

    async function fetchNetwork() {
      if (!currentToken) return;
      try {
        const res = await fetch("/api/network", { headers: { "Authorization": "Bearer " + currentToken } });
        if (!res.ok) return;
        const nodes = await res.json();
        const list = document.getElementById("network-nodes-list");
        list.innerHTML = (nodes || []).map(n => `
          <div style="padding: 0.85rem; background: rgba(15, 23, 42, 0.6); border-radius: 10px; border: 1px solid rgba(51, 65, 85, 0.4); display: flex; justify-content: space-between; align-items: center;">
            <div>
              <strong style="font-size: 0.85rem; color: #60a5fa;">${n.ip}</strong>
              <div style="font-size: 0.75rem; color: var(--text-muted);">${n.hostname} (${n.os_guess || 'Inconnu'})</div>
            </div>
            <span class="badge badge-ok">${n.status || 'Détecté'}</span>
          </div>
        `).join("") || "<p style='color: var(--text-muted); font-size: 0.75rem;'>Aucun nœud réseau actif détecté.</p>";
      } catch (e) {
        console.error(e);
      }
    }

    if (currentToken && currentRole) {
      showApp();
    }
  </script>
</body>
</html>"##
    .to_string()
}
