use crate::models::Alert;

pub struct SiemExporter;

impl SiemExporter {
    /// Formatage CEF (Common Event Format - HP ArcSight / Micro Focus / Splunk)
    /// Exemple: CEF:0|DefuDelog|Platform|2.0|DATA_LEAK|Fuite de données suspecte|8|src=192.168.1.50 cat=data_leak msg=Exfiltration vers S3
    pub fn to_cef(alert: &Alert) -> String {
        let severity_score = match alert.level {
            crate::models::AlertLevel::High => 9,
            crate::models::AlertLevel::Moderate => 6,
            crate::models::AlertLevel::Low => 3,
            crate::models::AlertLevel::Benign => 1,
        };

        let device_vendor = "DefuDelog";
        let device_product = "Platform";
        let device_version = "2.0";
        let signature_id = alert.category.to_string().to_uppercase();
        let name = alert.template.as_deref().unwrap_or("Alerte de Sécurité");

        let reasons_escaped = alert.reasons.join(" ; ").replace('|', "\\|").replace('=', "\\=");
        let detected_at = alert.detected_at.to_rfc3339();

        format!(
            "CEF:0|{}|{}|{}|{}|{}|{}|rt={} cat={} score={:.2} msg={}",
            device_vendor,
            device_product,
            device_version,
            signature_id,
            name,
            severity_score,
            detected_at,
            alert.category,
            alert.final_score,
            reasons_escaped
        )
    }

    /// Formatage LEEF (Log Event Extended Format - IBM QRadar)
    /// Exemple: LEEF:2.0|DefuDelog|Platform|2.0|DATA_LEAK|\tdevTime=... \tcat=data_leak \tsev=8
    pub fn to_leef(alert: &Alert) -> String {
        let severity_score = match alert.level {
            crate::models::AlertLevel::High => 9,
            crate::models::AlertLevel::Moderate => 6,
            crate::models::AlertLevel::Low => 3,
            crate::models::AlertLevel::Benign => 1,
        };

        let reasons_str = alert.reasons.join(" ; ");
        let detected_at = alert.detected_at.to_rfc3339();

        format!(
            "LEEF:2.0|DefuDelog|Platform|2.0|{}\tdevTime={}\tcat={}\tsev={}\tscore={:.2}\tusrMsg={}",
            alert.category.to_string().to_uppercase(),
            detected_at,
            alert.category,
            severity_score,
            alert.final_score,
            reasons_str
        )
    }

    /// Formatage Syslog RFC 5424 (Standard IETF Syslog)
    pub fn to_syslog_rfc5424(alert: &Alert) -> String {
        let pri = match alert.level {
            crate::models::AlertLevel::High => 11,     // Priority: Alert (Facility 1, Severity 3)
            crate::models::AlertLevel::Moderate => 12, // Priority: Warning
            crate::models::AlertLevel::Low => 13,      // Priority: Notice
            crate::models::AlertLevel::Benign => 14,   // Priority: Info
        };

        let timestamp = alert.detected_at.to_rfc3339();
        let app_name = "defudelog";
        let proc_id = "-";
        let msg_id = alert.category.to_string();
        let reasons = alert.reasons.join(" ; ");

        format!(
            "<{}>1 {} localhost {} {} {} [alert@defudelog level=\"{}\" score=\"{:.2}\"] {}",
            pri, timestamp, app_name, proc_id, msg_id, alert.level, alert.final_score, reasons
        )
    }

    /// Exporter un ensemble d'alertes dans le format spécifié
    pub fn export_batch(alerts: &[Alert], format_type: &str) -> String {
        match format_type.to_lowercase().as_str() {
            "cef" => alerts.iter().map(Self::to_cef).collect::<Vec<_>>().join("\n"),
            "leef" => alerts.iter().map(Self::to_leef).collect::<Vec<_>>().join("\n"),
            "syslog" => alerts.iter().map(Self::to_syslog_rfc5424).collect::<Vec<_>>().join("\n"),
            _ => alerts.iter().map(Self::to_cef).collect::<Vec<_>>().join("\n"),
        }
    }
}
