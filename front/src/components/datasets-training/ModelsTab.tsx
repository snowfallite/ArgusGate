import { useEffect, useState } from "react";
import { Boxes } from "lucide-react";
import { api } from "@/api/client";
import type { MLModel } from "@/api/types";
import { ModelCard } from "./ModelCard";
import { ModelDetailModal } from "./ModelDetailModal";

interface Props {
  onOpenJob: (jobId: string) => void;
}

export function ModelsTab({ onOpenJob }: Props) {
  const [models, setModels] = useState<MLModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [activating, setActivating] = useState<string | null>(null);
  const [evalingId, setEvalingId] = useState<string | null>(null);
  const [evalForModel, setEvalForModel] = useState<string | null>(null);
  const [evalResult, setEvalResult] = useState<Record<string, any> | null>(null);
  const [message, setMessage] = useState<{ id: string; type: "success" | "error"; text: string } | null>(null);

  const refresh = () => {
    return api.get<MLModel[]>("/models").then(setModels).catch(() => {});
  };

  useEffect(() => {
    refresh().finally(() => setLoading(false));
  }, []);

  const handleActivate = async (id: string) => {
    setActivating(id);
    setMessage(null);
    try {
      const res = await api.post<{
        activated: boolean;
        activation_result: { success: boolean; error?: string; fallback?: string };
      }>(`/models/${id}/activate`);
      await refresh();
      setMessage(
        res.activation_result.success
          ? { id, type: "success", text: "Адаптер активирован" }
          : {
              id,
              type: "error",
              text: `Ошибка: ${res.activation_result.error}. Откат: ${res.activation_result.fallback ?? "—"}`,
            },
      );
    } catch (e: any) {
      setMessage({ id, type: "error", text: e?.message ?? "Не удалось активировать" });
    } finally {
      setActivating(null);
    }
  };

  const handleEval = async (id: string) => {
    setEvalingId(id);
    setEvalForModel(id);
    setEvalResult(null);
    try {
      const res = await api.post<Record<string, any>>(`/models/eval?model_id=${id}`);
      setEvalResult(res);
    } catch (e: any) {
      setEvalResult({ error: e?.message ?? "eval failed" });
    } finally {
      setEvalingId(null);
    }
  };

  const handleDeleted = (id: string) => {
    setModels((prev) => prev.filter((m) => m.id !== id));
  };

  if (loading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {Array.from({ length: 2 }).map((_, i) => (
          <div key={i} className="h-44 bg-surface-1 border border-border-subtle rounded-xl animate-pulse" />
        ))}
      </div>
    );
  }

  if (models.length === 0) {
    return (
      <div className="bg-surface-1 border border-border-subtle rounded-xl px-4 py-10 text-center text-text-tertiary text-[13px] flex flex-col items-center gap-2">
        <Boxes className="w-8 h-8 opacity-20" />
        <span>Моделей нет</span>
      </div>
    );
  }

  return (
    <>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {models.map((m) => (
          <ModelCard
            key={m.id}
            model={m}
            evalBusy={evalingId === m.id}
            activating={activating === m.id}
            message={message?.id === m.id ? { type: message.type, text: message.text } : null}
            evalResult={evalForModel === m.id ? evalResult : null}
            onClick={() => setDetailId(m.id)}
            onEval={() => handleEval(m.id)}
            onActivate={() => handleActivate(m.id)}
          />
        ))}
      </div>

      <ModelDetailModal
        open={!!detailId}
        modelId={detailId}
        onClose={() => setDetailId(null)}
        onChanged={refresh}
        onDeleted={handleDeleted}
        onOpenJob={onOpenJob}
      />
    </>
  );
}
