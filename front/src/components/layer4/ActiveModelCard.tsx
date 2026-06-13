import { useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  Calendar,
  Cpu,
  ExternalLink,
  HardDrive,
  RotateCcw,
  Server,
  Settings2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { api } from "@/api/client";
import type { RuntimeInfo } from "./AdapterInfoCard";

interface Props {
  runtime: RuntimeInfo | null;
  loading: boolean;
  stale: boolean;
  onDeactivated?: () => void | Promise<void>;
  onRetry?: () => void | Promise<void>;
}

function relativeTime(iso: string | null): string {
  if (!iso) return "—";
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return "только что";
  if (diff < 3600) return `${Math.floor(diff / 60)} мин назад`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} ч назад`;
  return new Date(iso).toLocaleString();
}

function RuntimeFooter({ runtime }: { runtime: RuntimeInfo }) {
  const isOnnx = runtime.backend === "onnx_runtime";
  return (
    <div className="pt-3 border-t border-border-subtle text-[11px] text-text-tertiary flex flex-wrap items-center gap-x-4 gap-y-1 font-mono">
      <span>
        backend:{" "}
        <span className={isOnnx ? "text-status-success" : "text-status-warning"}>
          {runtime.backend ?? "—"}
        </span>
      </span>
      {runtime.device && (
        <span>
          device:{" "}
          <span className={runtime.device === "cuda" ? "text-status-success" : "text-text-secondary"}>
            {runtime.device}
          </span>
          {runtime.device_pref && runtime.device_pref !== runtime.device && (
            <span className="text-text-tertiary"> (pref: {runtime.device_pref})</span>
          )}
        </span>
      )}
      {runtime.loaded_at && (
        <span title={runtime.loaded_at}>загружена {relativeTime(runtime.loaded_at)}</span>
      )}
      <span className="ml-auto">
        pass≥{runtime.threshold_pass.toFixed(2)} · block≥{runtime.threshold_block.toFixed(2)}
      </span>
    </div>
  );
}

function StaleBanner() {
  return (
    <div className="px-3 py-2 rounded-md bg-[rgba(245,166,35,0.1)] border border-[rgba(245,166,35,0.3)] text-[12px] text-status-warning flex items-center gap-2">
      <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
      <span>backend не отвечает — данные могут быть устаревшими</span>
    </div>
  );
}

export function ActiveModelCard({ runtime, loading, stale, onDeactivated, onRetry }: Props) {
  const [deactivating, setDeactivating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (loading && !runtime) {
    return <div className="content-card h-48 bg-surface-2 animate-pulse" />;
  }

  if (!runtime) {
    return (
      <div className="content-card flex flex-col gap-3">
        <h3 className="text-body-strong flex items-center gap-2">
          <Cpu className="w-4 h-4" /> Активная модель
        </h3>
        <div className="px-3 py-3 rounded-md bg-[rgba(245,166,35,0.08)] border border-[rgba(245,166,35,0.25)] text-[12px] text-status-warning flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>Backend недоступен</span>
        </div>
        {onRetry && (
          <button
            onClick={() => onRetry()}
            className="self-start px-3 py-1.5 rounded-md bg-surface-2 border border-border-default text-[12px] hover:text-text-primary hover:border-accent flex items-center gap-1.5"
          >
            <RotateCcw className="w-3.5 h-3.5" /> Повторить
          </button>
        )}
      </div>
    );
  }

  const hasAdapter = Boolean(runtime.active_adapter_path);
  const m = hasAdapter ? runtime.adapter_meta : null;
  const hp = m?.training_job?.hyperparameters ?? {};
  const metrics = m?.metrics ?? {};

  const handleDeactivate = async () => {
    if (stale || deactivating) return;
    setDeactivating(true);
    setError(null);
    try {
      await api.post<{ deactivated: boolean; error?: string | null }>(
        "/layers/4/deactivate-adapter",
      );
      await onDeactivated?.();
    } catch (e: any) {
      setError(e?.message ?? "Не удалось переключить");
    } finally {
      setDeactivating(false);
    }
  };

  return (
    <div className="content-card flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-body-strong flex items-center gap-2">
          <Cpu className="w-4 h-4" /> Активная модель
        </h3>
        <div className="flex items-center gap-2">
          {hasAdapter ? (
            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase bg-[rgba(70,167,88,0.1)] text-status-success border border-[rgba(70,167,88,0.2)]">
              LoRA adapter
            </span>
          ) : (
            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase bg-surface-2 text-text-secondary border border-border-default">
              Базовая модель
            </span>
          )}
          {hasAdapter && (
            <button
              onClick={handleDeactivate}
              disabled={stale || deactivating}
              title={stale ? "backend не отвечает" : "Перейти на базовую модель"}
              className="px-2.5 py-1 rounded-md text-[11px] font-medium border border-status-critical/40 text-status-critical hover:bg-status-critical/10 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1"
            >
              <Server className="w-3 h-3" />
              {deactivating ? "..." : "На базовую"}
            </button>
          )}
        </div>
      </div>

      {stale && <StaleBanner />}

      {hasAdapter && !m && (
        <div className="text-[12px] text-text-secondary font-mono break-all px-2 py-1.5 bg-surface-2 rounded border border-border-subtle">
          {runtime.active_adapter_path}
        </div>
      )}

      {hasAdapter && m ? (
        <>
          <div className="text-[13px] font-medium text-text-primary truncate" title={m.name}>
            {m.name}
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="bg-surface-2 px-3 py-2 rounded-md border border-border-subtle flex flex-col">
              <span className="text-[10px] uppercase tracking-wider text-text-tertiary font-medium flex items-center gap-1">
                <Calendar className="w-2.5 h-2.5" /> Дата обучения
              </span>
              <span className="text-[12px] text-text-primary font-mono">
                {m.created_at ? new Date(m.created_at).toLocaleDateString() : "—"}
              </span>
            </div>
            <div className="bg-surface-2 px-3 py-2 rounded-md border border-border-subtle flex flex-col">
              <span className="text-[10px] uppercase tracking-wider text-text-tertiary font-medium flex items-center gap-1">
                <HardDrive className="w-2.5 h-2.5" /> Размер
              </span>
              <span className="text-[12px] text-text-primary font-mono">
                {m.size_mb !== null ? `${m.size_mb.toFixed(1)} MB` : "—"}
              </span>
            </div>
          </div>

          {Object.keys(metrics).length > 0 && (
            <div className="grid grid-cols-3 gap-1.5">
              {(["precision", "recall", "f1"] as const).map((k) => {
                const v = metrics[k];
                return (
                  <div key={k} className="bg-surface-2 px-2 py-1.5 rounded border border-border-subtle">
                    <div className="text-[10px] text-text-tertiary uppercase">{k}</div>
                    <div className="font-mono font-bold text-[13px]">
                      {typeof v === "number" ? v.toFixed(3) : "—"}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {m.training_job && (
            <div className="flex flex-col gap-1.5 pt-2 border-t border-border-subtle">
              <span className="text-[10px] uppercase tracking-wider text-text-tertiary font-medium flex items-center gap-1">
                <Settings2 className="w-2.5 h-2.5" /> Параметры обучения
              </span>
              <div className="flex flex-wrap gap-1.5 text-[11px] font-mono">
                <span className="bg-surface-3 px-1.5 py-0.5 rounded">{m.training_job.method ?? "lora"}</span>
                {hp.lora_r !== undefined && <span className="bg-surface-3 px-1.5 py-0.5 rounded">r={hp.lora_r}</span>}
                {hp.lora_alpha !== undefined && <span className="bg-surface-3 px-1.5 py-0.5 rounded">α={hp.lora_alpha}</span>}
                {hp.epochs !== undefined && <span className="bg-surface-3 px-1.5 py-0.5 rounded">epochs={hp.epochs}</span>}
                {hp.learning_rate !== undefined && <span className="bg-surface-3 px-1.5 py-0.5 rounded">lr={hp.learning_rate}</span>}
                {m.training_job.duration_seconds && (
                  <span className="bg-surface-3 px-1.5 py-0.5 rounded text-text-tertiary">
                    {Math.round(m.training_job.duration_seconds)}с
                  </span>
                )}
              </div>
            </div>
          )}

          {m.training_job && (
            <Link
              to={`/datasets-training?tab=jobs&job_id=${m.training_job.id}`}
              className="inline-flex items-center gap-1 text-[12px] text-accent hover:underline self-start"
            >
              Перейти к training job <ExternalLink className="w-3 h-3" />
            </Link>
          )}
        </>
      ) : (
        <div className="px-4 py-3 rounded-md bg-surface-2 border border-border-subtle flex flex-col gap-1">
          <div className="text-[12px] text-text-secondary">
            Используется базовая модель без LoRA-адаптера:
          </div>
          <code className="text-[11px] font-mono text-accent break-all">{runtime.base_model}</code>
          <p className="text-[11px] text-text-tertiary mt-1">
            Чтобы подключить дообученный адаптер — выберите его в селекторе слева или обучите новый
            на странице «Датасеты и обучение».
          </p>
        </div>
      )}

      {error && (
        <div className="text-[12px] px-2 py-1.5 rounded bg-[rgba(229,72,77,0.1)] text-status-critical">
          {error}
        </div>
      )}

      <RuntimeFooter runtime={runtime} />
    </div>
  );
}
