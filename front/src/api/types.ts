export interface OverviewMetrics {
  total_requests: number;
  blocked_requests: number;
  suspicious_requests: number;
  avg_latency_ms: number;
  block_rate: number;
  active_sessions: number;
  period_hours: number;
}

export interface TimelinePoint {
  time: string;
  total: number;
  blocked: number;
  suspicious: number;
}

export interface FunnelEntry {
  layer: number;
  layer_name: string;
  passed: number;
  filtered: number;
}

export interface CategoryCount {
  category: string;
  count: number;
}

export interface RecentEvent {
  id: string;
  timestamp: string;
  layer: number;
  verdict: string;
  category: string | null;
  score: number | null;
  reason: string | null;
  snippet: string;
}

export interface DetectionResult {
  layer: number;
  verdict: "pass" | "suspicious" | "block" | "escalate";
  score: number;
  category: string | null;
  matched_rule: string | null;
  reason: string;
  latency_ms: number;
  /** Set when the layer failed internally (e.g. no API key, network error). */
  error_detail?: string | null;
}

export interface AuditEntry {
  id: string;
  timestamp: string;
  request_text: string;
  normalized_text: string | null;
  session_id: string | null;
  final_verdict: string;
  total_latency_ms: number | null;
  provider: string | null;
  model: string | null;
}

export interface SessionState {
  session_id: string;
  turn_count: number;
  cumulative_risk_score: number;
  last_updated: string;
}

export interface SignatureRead {
  id: string;
  name: string;
  pattern: string;
  pattern_type: string;
  category: string | null;
  severity: string;
  enabled: boolean;
  hit_count: number;
  created_at: string;
  updated_at: string;
}

export interface SignatureCreate {
  id: string;
  name: string;
  pattern: string;
  pattern_type: string;
  category?: string;
  severity: string;
  enabled: boolean;
}

export interface Dataset {
  id: string;
  name: string;
  description: string | null;
  sample_count: number | null;
  train_count: number | null;
  val_count: number | null;
  test_count: number | null;
  categories: Record<string, number> | null;
  labels: Record<string, number> | null;
  source: string | null;
  created_at: string | null;
}

export interface TrainingSample {
  id: string;
  text: string;
  label: string | null;
  category: string | null;
  split: string | null;
  source_event_id: string | null;
  created_at: string | null;
}

export interface DatasetSamplePage {
  items: TrainingSample[];
  total: number;
  page: number;
  page_size: number;
}

export interface FromAuditPreview {
  total_matching: number;
  with_text: number;
  applicable: number;
  by_label: Record<string, number>;
  by_category: Record<string, number>;
}

export type AuditLabel = "confirmed_attack" | "false_positive" | "uncertain";

export interface FromAuditPayload {
  label_filter: AuditLabel[];
  max_samples: number;
  date_from?: string | null;
  date_to?: string | null;
  categories?: string[] | null;
}

export interface CreateFromAuditPayload extends FromAuditPayload {
  name: string;
  description?: string | null;
  train_pct: number;
  val_pct: number;
  test_pct: number;
}

export interface TrainingJob {
  id: string;
  dataset_id: string | null;
  status: string | null;
  method: string | null;
  base_model: string | null;
  hyperparameters: Record<string, number> | null;
  started_at: string | null;
  completed_at: string | null;
  duration_seconds: number | null;
  final_metrics: Record<string, number> | null;
  log_text: string | null;
  error_message: string | null;
  progress_percent: number;
}

export interface MLModel {
  id: string;
  name: string;
  type: string | null;
  base_model: string | null;
  target_layer: number | null;
  file_path: string | null;
  size_mb: number | null;
  metrics: Record<string, number> | null;
  is_active: boolean;
  training_job_id: string | null;
  created_at: string | null;
}

export interface ModelDetail extends MLModel {
  training_job: TrainingJob | null;
}

export type DevicePref = "auto" | "cpu" | "cuda";
export type DeviceTarget = "layer4" | "training";

export interface DeviceTargetState {
  pref: DevicePref;
  resolved: "cpu" | "cuda";
  fallback_reason: string | null;
}

export interface DeviceState {
  cuda_available: boolean;
  cuda_device_name: string | null;
  cuda_device_count: number;
  layer4: DeviceTargetState;
  training: DeviceTargetState;
}

export interface SetDeviceResult {
  state: DeviceState;
  adapter_reactivated: boolean;
}

export interface GpuStats {
  cuda_available: boolean;
  gpu_name: string | null;
  vram_total_gb: number | null;
  vram_used_gb: number | null;
  vram_free_gb: number | null;
  gpu_utilization_pct: number | null;
  train_est_vram_gb: number | null;
  train_after_vram_gb: number | null;
  train_delta_gb: number | null;
}

export interface TrainingJobMetric {
  epoch: number;
  eval_loss: number | null;
  precision: number | null;
  recall: number | null;
  f1: number | null;
}

export interface ClientKey {
  id: string;
  name: string;
  key_masked: string;
  created_at: string;
}

export interface SettingsOverview {
  provider_api_key_masked: string;
  client_keys: ClientKey[];
}

export interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

// ─── Statistics period ────────────────────────────────────────────────────────

export type Period = "24h" | "7d" | "30d" | "all";

// ─── Dashboard: layer threats widget ─────────────────────────────────────────

export interface LayerThreatEntry {
  layer: number;
  layer_name: string;
  blocked: number;
  top_category: string | null;
}

// ─── Layer statistics (GET /layers/{N}/stats) ─────────────────────────────────

export interface LayerStatsTotals {
  total: number;
  blocked: number;
  suspicious: number;
  passed: number;
  escalated: number;
  avg_score: number | null;
  avg_latency_ms: number | null;
}

export interface LayerStatsPoint {
  time: string;
  blocked: number;
  suspicious: number;
  passed: number;
  escalated: number;
}

export interface LayerStatsResponse {
  totals: LayerStatsTotals;
  timeline: LayerStatsPoint[];
  by_category: CategoryCount[];
  by_reason: Array<{ reason: string; count: number }>;
  hours: number;
}

/**
 * Ответ POST /api/pipeline/test.
 * JSON сериализует dict[int, ...] со строковыми ключами ("1", "2", ...).
 */
export interface PipelineTestResponse {
  layer_results: Record<string, DetectionResult>;
  final_verdict: "pass" | "suspicious" | "escalate" | "block";
  normalized_text: string | null;
  total_latency_ms: number;
  l5_skipped: boolean;
  l7_skipped: boolean;
}
