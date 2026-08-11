use crate::models::Alert;
use serde_json::json;

pub struct WebhookNotifier;

impl WebhookNotifier {
    /// Envoyer une alerte à une URL Webhook (Slack / Discord / Teams / Generic HTTP)
    pub async fn send_alert_notification(webhook_url: &str, alert: &Alert) -> Result<(), String> {
        if webhook_url.trim().is_empty() {
            return Ok(());
        }

        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(5))
            .build()
            .map_err(|e| e.to_string())?;

        let severity_emoji = match alert.level {
            crate::models::AlertLevel::High => "🚨",
            crate::models::AlertLevel::Moderate => "⚠️",
            crate::models::AlertLevel::Low => "ℹ️",
            crate::models::AlertLevel::Benign => "✅",
        };

        // Formater le payload générique compatible Slack/Discord/Teams/Custom
        let payload = json!({
            "text": format!(
                "{} *[DeFuDoLog] Alerte de Sécurité [{}]*\n> *Catégorie:* {}\n> *Niveau:* {}\n> *Score:* {:.0}%\n> *Raisons:* {}",
                severity_emoji,
                alert.category.to_string().to_uppercase(),
                alert.category,
                alert.level,
                alert.final_score * 100.0,
                alert.reasons.join(", ")
            ),
            "content": format!(
                "{} **[DeFuDoLog] Alerte [{}]**: {} (Score: {:.0}%)",
                severity_emoji,
                alert.category,
                alert.reasons.join(", "),
                alert.final_score * 100.0
            ),
            "alert_id": alert.id,
            "category": alert.category,
            "level": alert.level,
            "score": alert.final_score,
            "reasons": alert.reasons,
            "detected_at": alert.detected_at.to_rfc3339(),
        });

        let res = client.post(webhook_url)
            .json(&payload)
            .send()
            .await
            .map_err(|e| format!("Échec de l'envoi au webhook: {}", e))?;

        if !res.status().is_success() {
            return Err(format!("Le serveur Webhook a répondu avec le statut HTTP {}", res.status()));
        }

        Ok(())
    }

    /// Tester l'URL d'un webhook avec un message de démonstration
    pub async fn test_webhook_url(webhook_url: &str) -> Result<(), String> {
        if webhook_url.trim().is_empty() {
            return Err("Veuillez saisir une URL de webhook valide (ex: https://hooks.slack.com/...)".to_string());
        }

        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(5))
            .build()
            .map_err(|e| e.to_string())?;

        let payload = json!({
            "text": "🟢 *[DeFuDoLog] Test de connexion Webhook réussi !*\n> Les notifications d'alertes en temps réel sont désormais actives.",
            "content": "🟢 **[DeFuDoLog] Test de connexion Webhook réussi !**"
        });

        let res = client.post(webhook_url)
            .json(&payload)
            .send()
            .await
            .map_err(|e| format!("Impossible de contacter l'URL webhook: {}", e))?;

        if !res.status().is_success() {
            return Err(format!("Le serveur Webhook a renvoyé le statut HTTP {}", res.status()));
        }

        Ok(())
    }
}
