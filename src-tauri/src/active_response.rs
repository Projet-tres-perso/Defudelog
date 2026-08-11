use std::process::Command;
use crate::models::{Alert, AlertLevel};
use crate::error::AppError;
use crate::db::Database;
use std::sync::Arc;

pub struct ActiveResponseEngine {
    db: Arc<Database>,
}

impl ActiveResponseEngine {
    pub fn new(db: Arc<Database>) -> Self {
        Self { db }
    }

    pub fn trigger_response(&self, alert: &Alert) -> Result<(), AppError> {
        // We only respond to Critical/High alerts
        if alert.level != AlertLevel::High {
            return Ok(());
        }

        let mut script_path = std::env::temp_dir();
        script_path.push("defudolog_active_response.sh");

        // Fetch settings from DB
        let settings = self.db.get_settings().unwrap_or_default();
        let script_content = settings.active_response_script.unwrap_or_else(|| {
            format!("#!/bin/sh\n\
                     echo 'DefuDoLog Active Response triggered for Alert: $1 | Category: $2' >> /tmp/defudolog_soar.log\n")
        });

        let _ = std::fs::write(&script_path, script_content);
        
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            if let Ok(mut perms) = std::fs::metadata(&script_path).map(|m| m.permissions()) {
                perms.set_mode(0o755);
                let _ = std::fs::set_permissions(&script_path, perms);
            }
        }

        log::warn!("🔥 SOAR: Déclenchement de la mitigation active pour l'alerte {}", alert.id);

        let status = Command::new(&script_path)
            .arg(&alert.id)
            .arg(format!("{:?}", alert.category))
            .spawn()
            .map_err(|e| AppError::Io(e))?;

        log::info!("SOAR script started with PID {:?}", status.id());

        Ok(())
    }
}
