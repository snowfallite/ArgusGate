import { useEffect, useMemo, useState } from "react";
import { Cpu, ExternalLink, Play, Server } from "lucide-react";
import { Link } from "react-router-dom";
import { api } from "@/api/client";
import type { Dataset, DeviceState, GpuStats, TrainingJob } from "@/api/types";
import { fetchDeviceState } from "@/lib/deviceFetch";
import {
  HYPERPARAM_KEYS,
  HYPERPARAMS,
  type HyperparamKey,
  defaultHyperparams,
} from "@/lib/hyperparams";
import { Modal } from "./Modal";
import { HyperparamInput } from "./HyperparamInput";
import { InfoTooltip } from "./InfoTooltip";
import { cn } from "@/lib/utils";

interface Props {
  open: boolean;
  onClose: () => void;
  onCreated: (job: TrainingJob) => void;
  datasets: Dataset[];
  initialFromJob?: TrainingJob | null;
}

const DEFAULT_BASE_MODEL = "protectai/deberta-v3-base-prompt-injection-v2";

export function JobWizardModal({ open, onClose, onCreated, datasets, initialFromJob }: Props) {
  const [datasetId, setDatasetId] = useState("");
  const [method, setMethod] = useState<"lora" | "qlora">("lora");
  const [baseModel, setBaseModel] = useState(DEFAULT_BASE_MODEL);
  const [hyperparams, setHyperparams] = useState<Record<HyperparamKey, number>>(defaultHyperparams);
  const [launching, setLaunching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [device, setDevice] = useState<DeviceState | null>(null);
  const [gpuStats, setGpuStats] = useState<GpuStats | null>(null);

  useEffect(() => {
    if (!open) return;
    fetchDeviceState().then(setDevice).catch(() => setDevice(null));
    api.get<GpuStats>("/system/gpu-stats").then(setGpuStats).catch(() => setGpuStats(null));
  }, [open]);

  useEffect(() => {
    if (!open) return;
    if (initialFromJob) {
      setDatasetId(initialFromJob.dataset_id ?? "");
      setMethod(((initialFromJob.method as "lora" | "qlora") ?? "lora"));
      setBaseModel(initialFromJob.base_model ?? DEFAULT_BASE_MODEL);
      const merged = { ...defaultHyperparams() };
      for (const k of HYPERPARAM_KEYS) {
        const v = initialFromJob.hyperparameters?.[k];
        if (typeof v === "number") merged[k] = v;
      }
      setHyperparams(merged);
    } else {
      setDatasetId("");
      setMethod("lora");
      setBaseModel(DEFAULT_BASE_MODEL);
      setHyperparams(defaultHyperparams());
    }
    setError(null);
  }, [open, initialFromJob?.id]);

  const selectedDataset = useMemo(
    () => datasets.find((d) => d.id === datasetId) ?? null,
    [datasets, datasetId],
  );

  const canLaunch = !!datasetId && !launching && baseModel.trim().length > 0;

  const handleLaunch = async () => {
    if (!canLaunch) return;
    setLaunching(true);
    setError(null);
    try {
      const job = await api.post<TrainingJob>("/training/jobs", {
        dataset_id: datasetId,
        method,
        base_model: baseModel.trim(),
        hyperparameters: { ...hyperparams },
      });
      onCreated(job);
      onClose();
    } catch (e: any) {
      setError(e?.message ?? "Не удалось запустить");
    } finally {
      setLaunching(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Новая задача обучения"
      maxWidth="max-w-2xl"
      footer={
        <>
          <button
            onClick={onClose}
            disabled={launching}
            className="px-3.5 py-1.5 rounded-md text-[13px] text-text-secondary hover:text-text-primary hover:bg-surface-3 disabled:opacity-40"
          >
            Отмена
          </button>
          <button
            onClick={handleLaunch}
            disabled={!canLaunch}
            className="px-4 py-1.5 rounded-md text-[13px] font-medium bg-accent text-white hover:opacity-90 flex items-center gap-2 disabled:opacity-40"
          >
            <Play className="w-3.5 h-3.5 fill-current" />
            {launching ? "..." : "Запустить"}
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        {device && (
          <div className="flex flex-col gap-2 px-3 py-2.5 rounded-lg bg-surface-2 border border-border-subtle">
            {/* Строка: устройство + ссылка */}
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-[12px]">
                {device.training.resolved === "cuda" ? (
                  <Server className="w-3.5 h-3.5 text-status-success" />
                ) : (
                  <Cpu className="w-3.5 h-3.5 text-text-secondary" />
                )}
                <span className="text-text-secondary">обучение на:</span>
                <span className={cn(
                  "font-mono",
                  device.training.resolved === "cuda" ? "text-status-success" : "text-text-primary",
                )}>
                  {device.training.resolved}
                  {device.cuda_device_name && device.training.resolved === "cuda" && (
                    <span className="text-text-tertiary"> · {device.cuda_device_name}</span>
                  )}
                </span>
                {device.training.pref !== device.training.resolved && (
                  <span className="text-text-tertiary text-[11px]">(pref: {device.training.pref})</span>
                )}
              </div>
              <Link
                to="/datasets-training?tab=config"
                className="inline-flex items-center gap-1 text-[11px] text-accent hover:underline shrink-0"
              >
                изменить <ExternalLink className="w-3 h-3" />
              </Link>
            </div>

            {/* GPU-статистика (только CUDA) */}
            {gpuStats?.cuda_available && device.training.resolved === "cuda" && (
              <div className="flex flex-col gap-1.5 pt-1 border-t border-border-subtle/60">
                {/* VRAM-бар */}
                {gpuStats.vram_total_gb != null && gpuStats.vram_used_gb != null && (
                  <div className="flex items-center gap-2 text-[11px]">
                    <span className="text-text-tertiary w-16 shrink-0">VRAM</span>
                    <div className="flex-1 bg-surface-3 rounded-full h-1.5 overflow-hidden">
                      {/* Текущее использование */}
                      <div
                        className="h-full rounded-full bg-accent/60 transition-all"
                        style={{ width: `${Math.min((gpuStats.vram_used_gb / gpuStats.vram_total_gb) * 100, 100)}%` }}
                      />
                    </div>
                    <span className="text-text-secondary tabular-nums">
                      {gpuStats.vram_used_gb.toFixed(1)}
                      <span className="text-text-tertiary"> / {gpuStats.vram_total_gb.toFixed(1)} GB</span>
                    </span>
                  </div>
                )}

                {/* Загрузка GPU + прогноз */}
                <div className="flex items-center gap-3 flex-wrap text-[11px]">
                  {gpuStats.gpu_utilization_pct != null && (
                    <span className="text-text-tertiary">
                      загрузка:
                      <span className={cn(
                        "ml-1 font-mono font-medium",
                        gpuStats.gpu_utilization_pct > 80
                          ? "text-status-warning"
                          : "text-text-primary",
                      )}>
                        {gpuStats.gpu_utilization_pct.toFixed(0)}%
                      </span>
                    </span>
                  )}
                  {gpuStats.train_delta_gb != null && gpuStats.train_after_vram_gb != null && (
                    <span className="text-text-tertiary">
                      после запуска:
                      <span className="ml-1 font-mono text-text-primary">
                        +{gpuStats.train_delta_gb.toFixed(1)} GB
                      </span>
                      <span className="ml-1 text-text-tertiary">
                        → {gpuStats.train_after_vram_gb.toFixed(1)} GB
                      </span>
                      {gpuStats.vram_total_gb != null &&
                        gpuStats.train_after_vram_gb > gpuStats.vram_total_gb * 0.95 && (
                          <span className="ml-1 text-status-warning font-medium">⚠ мало памяти</span>
                        )}
                    </span>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        <section className="flex flex-col gap-3">
          <div className="text-[10px] font-bold text-text-secondary uppercase tracking-wider">
            Источник
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-[12px] font-medium text-text-secondary">Датасет</label>
            {datasets.length === 0 ? (
              <p className="text-[12px] text-status-warning">Сначала создайте датасет</p>
            ) : (
              <select
                value={datasetId}
                onChange={(e) => setDatasetId(e.target.value)}
                className="bg-surface-2 border border-border-default rounded-lg px-3 py-2 text-[13px] focus:outline-none focus:border-accent"
              >
                <option value="">Выберите датасет…</option>
                {datasets.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                    {d.sample_count != null ? ` (${d.sample_count.toLocaleString()})` : ""}
                  </option>
                ))}
              </select>
            )}
            {selectedDataset && (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] font-mono text-text-tertiary">
                {selectedDataset.labels && (
                  <>
                    {Object.entries(selectedDataset.labels).map(([k, v]) => (
                      <span key={k}>
                        <span className="text-text-secondary">{k} </span>
                        {v}
                      </span>
                    ))}
                  </>
                )}
                {selectedDataset.train_count != null && (
                  <>
                    <span>
                      <span className="text-text-secondary">train </span>
                      {selectedDataset.train_count}
                    </span>
                    <span>
                      <span className="text-text-secondary">val </span>
                      {selectedDataset.val_count}
                    </span>
                    <span>
                      <span className="text-text-secondary">test </span>
                      {selectedDataset.test_count}
                    </span>
                  </>
                )}
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center gap-2">
                <label className="text-[12px] font-medium text-text-secondary">Метод</label>
                <InfoTooltip
                  text="LoRA — стандартный режим. QLoRA — то же, но базовая модель загружается в 4-битной квантизации (экономия памяти, незначительная потеря качества)."
                />
              </div>
              <div className="flex gap-1.5">
                {(["lora", "qlora"] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setMethod(m)}
                    className={cn(
                      "px-3 py-1.5 rounded-md text-[12px] font-mono border transition-colors flex-1",
                      method === m
                        ? "bg-accent/15 text-accent border-accent/40"
                        : "bg-surface-2 text-text-secondary border-border-default hover:text-text-primary",
                    )}
                  >
                    {m}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <div className="flex items-center gap-2">
                <label className="text-[12px] font-medium text-text-secondary">Базовая модель</label>
                <InfoTooltip
                  text="HuggingFace-идентификатор предобученной модели, поверх которой обучается LoRA-адаптер."
                />
              </div>
              <input
                type="text"
                value={baseModel}
                onChange={(e) => setBaseModel(e.target.value)}
                className="bg-surface-2 border border-border-default rounded-lg px-3 py-2 text-[13px] font-mono focus:outline-none focus:border-accent"
              />
            </div>
          </div>
        </section>

        <section className="flex flex-col gap-3 border-t border-border-subtle pt-4">
          <div className="text-[10px] font-bold text-text-secondary uppercase tracking-wider">
            Гиперпараметры
          </div>
          <div className="grid grid-cols-2 gap-3">
            {HYPERPARAM_KEYS.map((k) => (
              <HyperparamInput
                key={k}
                meta={HYPERPARAMS[k]}
                value={hyperparams[k]}
                onChange={(v) => setHyperparams((prev) => ({ ...prev, [k]: v }))}
              />
            ))}
          </div>
        </section>

        {error && <p className="text-[12px] text-status-critical">{error}</p>}
      </div>
    </Modal>
  );
}
