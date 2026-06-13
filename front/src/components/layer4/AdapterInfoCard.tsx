/**
 * Тип-модуль с описанием runtime-снапшота Layer 4.
 *
 * Раньше здесь жил полноценный компонент `AdapterInfoCard`. Его UI заменён
 * объединённым `ActiveModelCard` (включает runtime-сводку и кнопку перехода
 * на базовую модель). Файл оставлен ради стабильных импортов типа `RuntimeInfo`
 * из других мест (Layer4MLClassifier, ActiveModelCard, deep-link фронта).
 */

export interface AdapterMeta {
  id: string;
  name: string;
  size_mb: number | null;
  metrics: { precision?: number; recall?: number; f1?: number; accuracy?: number } | null;
  created_at: string | null;
  training_job: {
    id: string;
    method: string | null;
    hyperparameters: Record<string, any> | null;
    dataset_id: string | null;
    duration_seconds: number | null;
  } | null;
}

export interface RuntimeInfo {
  loaded: boolean;
  backend: string | null;
  base_model: string;
  active_adapter_path: string | null;
  previous_adapter_path: string | null;
  loaded_at: string | null;
  model_path: string;
  threshold_pass: number;
  threshold_block: number;
  adapter_meta: AdapterMeta | null;
  device?: "cpu" | "cuda";
  device_pref?: "auto" | "cpu" | "cuda";
  device_fallback_reason?: string | null;
}
