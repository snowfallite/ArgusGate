import { useEffect, useState } from "react";
import { Copy, ExternalLink, Play, Trash2 } from "lucide-react";
import { api } from "@/api/client";
import type { ModelDetail } from "@/api/types";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { formatDuration } from "@/lib/trainingStatus";
import { cn } from "@/lib/utils";
import { Modal } from "./Modal";
import { HyperparamBadges } from "./HyperparamBadges";

interface Props {
  open: boolean;
  modelId: string | null;
  onClose: () => void;
  onChanged: () => void;
  onDeleted: (id: string) => void;
  onOpenJob: (jobId: string) => void;
}

export function ModelDetailModal({
  open,
  modelId,
  onClose,
  onChanged,
  onDeleted,
  onOpenJob,
}: Props) {
  const [model, setModel] = useState<ModelDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [evalBusy, setEvalBusy] = useState(false);
  const [evalResult, setEvalResult] = useState<Record<string, any> | null>(null);
  const [activating, setActivating] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [pendingDelete, setPendingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (!open || !modelId) {
      setModel(null);
      setEvalResult(null);
      setMessage(null);
      return;
    }
    setLoading(true);
    api
      .get<ModelDetail>(`/models/${modelId}`)
      .then(setModel)
      .catch(() => setModel(null))
      .finally(() => setLoading(false));
  }, [open, modelId]);

  const handleActivate = async () => {
    if (!model) return;
    setActivating(true);
    setMessage(null);
    try {
      const res = await api.post<{
        activated: boolean;
        activation_result: { success: boolean; error?: string; fallback?: string };
      }>(`/models/${model.id}/activate`);
      const detail = await api.get<ModelDetail>(`/models/${model.id}`);
      setModel(detail);
      onChanged();
      setMessage(
        res.activation_result.success
          ? { type: "success", text: "Адаптер активирован" }
          : {
              type: "error",
              text: `Ошибка: ${res.activation_result.error}. Откат: ${res.activation_result.fallback ?? "—"}`,
            },
      );
    } catch (e: any) {
      setMessage({ type: "error", text: e?.message ?? "Не удалось активировать" });
    } finally {
      setActivating(false);
    }
  };

  const handleEval = async () => {
    if (!model) return;
    setEvalBusy(true);
    setEvalResult(null);
    try {
      const r = await api.post<Record<string, any>>(`/models/eval?model_id=${model.id}`);
      setEvalResult(r);
    } catch (e: any) {
      setEvalResult({ error: e?.message ?? "eval failed" });
    } finally {
      setEvalBusy(false);
    }
  };

  const handleDelete = async () => {
    if (!model) return;
    setDeleting(true);
    try {
      await api.delete(`/models/${model.id}`);
      onDeleted(model.id);
      setPendingDelete(false);
      onClose();
    } catch (e: any) {
      setMessage({ type: "error", text: e?.message ?? "Не удалось удалить" });
      setPendingDelete(false);
    } finally {
      setDeleting(false);
    }
  };

  const copyFilePath = async () => {
    if (!model?.file_path) return;
    try {
      await navigator.clipboard.writeText(model.file_path);
      setMessage({ type: "success", text: "Путь скопирован" });
    } catch {
      // ignore
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={model?.name ?? (loading ? "Загрузка…" : "Модель")}
      maxWidth="max-w-3xl"
      footer={
        model && (
          <>
            <button
              onClick={() => setPendingDelete(true)}
              disabled={model.is_active || deleting}
              title={model.is_active ? "Сначала активируйте другую модель" : "Удалить"}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[13px] text-status-critical border border-status-critical/40 hover:bg-status-critical/10 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Удалить
            </button>
            <div className="flex-1" />
            <button
              onClick={handleEval}
              disabled={evalBusy}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-surface-2 border border-border-default text-[13px] hover:text-accent hover:border-accent disabled:opacity-50"
            >
              <Play className="w-3.5 h-3.5 fill-current" />
              {evalBusy ? "…" : "Eval"}
            </button>
            {!model.is_active && (
              <button
                onClick={handleActivate}
                disabled={activating}
                className="px-4 py-1.5 rounded-md bg-accent text-white text-[13px] font-medium hover:opacity-90 disabled:opacity-50"
              >
                {activating ? "…" : "Активировать"}
              </button>
            )}
          </>
        )
      }
    >
      {loading || !model ? (
        <div className="text-[12px] text-text-tertiary font-mono">…</div>
      ) : (
        <div className="flex flex-col gap-5">
          <div className="flex items-center gap-2">
            {model.is_active ? (
              <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-[rgba(70,167,88,0.12)] text-status-success text-[11px]">
                <div className="w-2 h-2 rounded-full bg-status-success" />
                Активна
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-surface-2 text-text-tertiary text-[11px]">
                <div className="w-2 h-2 rounded-full bg-surface-3" />
                Неактивна
              </span>
            )}
            <span className="text-[10px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded bg-[rgba(74,158,255,0.1)] text-accent border border-[rgba(74,158,255,0.2)]">
              {model.type ?? "adapter"}
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-5 gap-y-2 text-[12px]">
            <div>
              <div className="text-text-tertiary mb-0.5">Базовая модель</div>
              <div className="font-mono text-text-primary truncate" title={model.base_model ?? ""}>
                {model.base_model ?? "—"}
              </div>
            </div>
            <div>
              <div className="text-text-tertiary mb-0.5">Целевой слой</div>
              <div className="font-mono text-text-primary">L{model.target_layer ?? "—"}</div>
            </div>
            <div>
              <div className="text-text-tertiary mb-0.5">Размер</div>
              <div className="font-mono text-text-primary">
                {model.size_mb != null ? `${model.size_mb.toFixed(2)} MB` : "—"}
              </div>
            </div>
            <div>
              <div className="text-text-tertiary mb-0.5">Создана</div>
              <div className="text-text-primary">
                {model.created_at ? new Date(model.created_at).toLocaleString() : "—"}
              </div>
            </div>
            <div className="md:col-span-2 flex items-start gap-2">
              <div className="flex-1 min-w-0">
                <div className="text-text-tertiary mb-0.5">Путь до файла</div>
                <div className="font-mono text-text-primary text-[11px] truncate" title={model.file_path ?? ""}>
                  {model.file_path ?? "—"}
                </div>
              </div>
            </div>
          </div>

          {model.training_job && (
            <div className="border-t border-border-subtle pt-4 flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <div className="text-[10px] font-bold text-text-secondary uppercase tracking-wider">
                  Задача обучения
                </div>
                <button
                  onClick={() => model.training_job && onOpenJob(model.training_job.id)}
                  className="flex items-center gap-1 text-[11px] text-accent hover:underline"
                >
                  Открыть <ExternalLink className="w-3 h-3" />
                </button>
              </div>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] font-mono text-text-secondary">
                <span>{model.training_job.method ?? "—"}</span>
                <HyperparamBadges hyperparameters={model.training_job.hyperparameters} />
                <span>
                  <span className="text-text-tertiary">Длительность </span>
                  {formatDuration(model.training_job.duration_seconds)}
                </span>
              </div>
            </div>
          )}

          {model.metrics && Object.keys(model.metrics).length > 0 && (
            <div className="border-t border-border-subtle pt-4">
              <div className="text-[10px] font-bold text-text-secondary uppercase tracking-wider mb-2">
                Метрики
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                {["precision", "recall", "f1", "accuracy"].map((k) => {
                  const v = model.metrics?.[k];
                  if (typeof v !== "number") return null;
                  return (
                    <div key={k} className="bg-surface-2 rounded-lg p-2.5">
                      <div className="text-[10px] text-text-tertiary uppercase">{k}</div>
                      <div className="text-[16px] font-bold font-mono text-text-primary">
                        {v.toFixed(4)}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {evalResult && (
            <div className="border-t border-border-subtle pt-4">
              <div className="text-[10px] font-bold text-text-secondary uppercase tracking-wider mb-2">
                Результат eval
              </div>
              {evalResult.error ? (
                <p className="text-[12px] text-status-critical">{String(evalResult.error)}</p>
              ) : (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                  {["precision", "recall", "f1", "accuracy"].map((k) => (
                    <div key={k} className="bg-surface-2 rounded-lg p-2.5">
                      <div className="text-[10px] text-text-tertiary uppercase">{k}</div>
                      <div className="text-[14px] font-bold font-mono text-text-primary">
                        {typeof evalResult[k] === "number" ? evalResult[k].toFixed(4) : "—"}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {message && (
            <div className={cn(
              "text-[12px] px-3 py-2 rounded-md",
              message.type === "success"
                ? "bg-[rgba(70,167,88,0.1)] text-status-success"
                : "bg-[rgba(229,72,77,0.1)] text-status-critical",
            )}>
              {message.text}
            </div>
          )}
        </div>
      )}

      <ConfirmDialog
        open={pendingDelete}
        title={model ? `Удалить «${model.name}»?` : ""}
        body="Файл адаптера будет удалён с диска. Связанная задача обучения сохранится."
        confirmLabel="Удалить"
        variant="danger"
        busy={deleting}
        onConfirm={handleDelete}
        onCancel={() => setPendingDelete(false)}
      />
    </Modal>
  );
}
