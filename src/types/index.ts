export type AlertLevel = "benign" | "low" | "moderate" | "high";
export type AlertCategory = "data_leak" | "authentication" | "system_anomaly" | "privilege_escalation" | "general";

export interface NetworkNode {
  hostname: string;
  ip_address: string;
  log_count: number;
  last_seen: string;
  os: string;
}

export interface LogSource {
  id: string;
  name: string;
  source_type: string;
  hostname: string;
  os: string;
  enabled: boolean;
  config: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface RawLog {
  id: string;
  source_id: string;
  hostname: string;
  raw_message: string;
  log_hash: string;
  timestamp: string;
  ingested_at: string;
}

export interface ParsedLog {
  id: string;
  raw_log_id: string;
  raw_message: string;
  template: string;
  template_id: number;
  parameters: string[];
  parsed_at: string;
}

export interface Alert {
  id: string;
  raw_log_id: string;
  parsed_log_id: string | null;
  template: string | null;
  category: AlertCategory;
  supervised_score: number | null;
  anomaly_score: number | null;
  cluster_id: number | null;
  is_outlier: boolean;
  final_score: number;
  level: AlertLevel;
  reasons: string[];
  context_logs: string[];
  detected_at: string;
  acknowledged: boolean;
  acknowledged_at: string | null;
}

export interface DetectionRule {
  id: string;
  name: string;
  description: string;
  rule_type: string;
  pattern: string;
  severity: AlertLevel;
  enabled: boolean;
  created_at: string;
}

export interface DashboardStats {
  total_logs: number;
  logs_last_24h: number;
  active_sources: number;
  total_templates: number;
  total_alerts: number;
  high_alerts: number;
  moderate_alerts: number;
  alerts_last_24h: number;
  top_templates: TemplateFrequency[];
  alert_trend: [string, number][];
}

export interface TemplateFrequency {
  template: string;
  count: number;
  alert_count: number;
}

export interface TimeSeriesPoint {
  time: string;
  logs: number;
  alerts: number;
}

export interface AppSettings {
  db_path: string;
  detection: DetectionSettings;
  kafka: KafkaSettings | null;
  llm: LlmSettings | null;
  active_response_script: string | null;
}

export interface DetectionSettings {
  batch_size: number;
  anomaly_threshold: number;
  supervised_threshold: number;
  dbscan_eps: number;
  dbscan_min_samples: number;
  time_window_seconds: number;
  event_threshold: number;
  auto_train: boolean;
  training_interval_hours: number;
}

export interface KafkaSettings {
  brokers: string[];
  input_topic: string;
  output_topic: string;
  group_id: string;
  sasl_username: string | null;
  sasl_password: string | null;
}

export interface LlmSettings {
  base_url: string;
  api_key: string;
  model: string;
  enabled: boolean;
}
