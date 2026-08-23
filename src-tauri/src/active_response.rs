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

        // Fetch settings from DB
        let settings = self.db.get_settings().unwrap_or_default();
        let script_content = match settings.active_response_script {
            Some(ref s) if !s.trim().is_empty() => s.clone(),
            _ => {
                #[cfg(unix)]
                {
                    "#!/bin/sh\necho \"DefuDoLog SOAR triggered for Alert: $1 | Category: $2\" >> /tmp/defudolog_soar.log\n".to_string()
                }
                #[cfg(windows)]
                {
                    "Write-Output \"DefuDoLog SOAR triggered for Alert: $args[0] | Category: $args[1]\" | Out-File -Append -FilePath \"$env:TEMP\\defudolog_soar.log\"\n".to_string()
                }
            }
        };

        Self::execute_script(&script_content, &alert.id, &format!("{:?}", alert.category))
    }

    pub fn execute_script(script_content: &str, arg1: &str, arg2: &str) -> Result<(), AppError> {
        let is_windows = cfg!(target_os = "windows");
        let mut script_path = std::env::temp_dir();

        if is_windows {
            script_path.push("defudolog_active_response.ps1");
            std::fs::write(&script_path, script_content)
                .map_err(AppError::Io)?;

            log::warn!("🔥 SOAR: Exécution du script PowerShell de mitigation: {:?}", script_path);

            let mut cmd = Command::new("powershell.exe");
            cmd.arg("-WindowStyle")
                .arg("Hidden")
                .arg("-NoProfile")
                .arg("-ExecutionPolicy")
                .arg("Bypass")
                .arg("-File")
                .arg(&script_path)
                .arg(arg1)
                .arg(arg2);

            #[cfg(windows)]
            {
                use std::os::windows::process::CommandExt;
                cmd.creation_flags(0x08000000);
            }

            cmd.spawn().map_err(AppError::Io)?;
        } else {
            script_path.push("defudolog_active_response.sh");
            std::fs::write(&script_path, script_content)
                .map_err(AppError::Io)?;

            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                if let Ok(mut perms) = std::fs::metadata(&script_path).map(|m| m.permissions()) {
                    perms.set_mode(0o755);
                    let _ = std::fs::set_permissions(&script_path, perms);
                }
            }

            log::warn!("🔥 SOAR: Exécution du script Shell de mitigation: {:?}", script_path);

            Command::new("/bin/sh")
                .arg(&script_path)
                .arg(arg1)
                .arg(arg2)
                .spawn()
                .map_err(AppError::Io)?;
        }

        Ok(())
    }
}
