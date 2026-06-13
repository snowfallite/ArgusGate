import { Play } from "lucide-react";
import type { MLModel } from "@/api/types";
import { cn } from "@/lib/utils";
import { HyperparamBadges } from "./HyperparamBadges";

interface Props {
  model: MLModel;
  evalBusy?: boolean;
  activating?: boolean;
  message?: { type: "success" | "error"; text: string } | null;
  evalResult?: Record<string, any> | null;
  onClick: () => void;
  onEval: () => void;
  onActivate: () => void;
}

export function ModelCard({
  model,
  evalBusy,
  activating,
  message,
  evalResult,
  onClick,
  onEval,
  onActivate,
}: Props) {
  return (
    <div
      onClick={onClick}
      className="bg-surface-1 border border-border-subtle rounded-xl p-5 hover:border-accent/50 transition-all shadow-sm flex flex-col cursor-pointer"
    >
      <div className="flex items-center justify-between mb-3">
        <span className="text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded bg-[rgba(74,158,255,0.1)] text-accent border border-[rgba(74,158,255,0.2)]">
          {model.type ?? "adapter"}
        </span>
        {model.is_active ? (
          <span className="flex items-center gap-1.5">
            <div className="w-2 h-2 rounded-full bg-status-success" />
            <span className="text-[11px] text-text-secondary">Активна</span>
          </span>
        ) : (
          <span className="flex items-center gap-1.5">
            <div className="w-2 h-2 rounded-full bg-surface-3" />
            <span className="text-[11px] text-text-tertiary">Неактивна</span>
          </span>
        )}
      </div>

      <h3 className="text-[15px] font-bold text-text-primary mb-1 truncate" title={model.name}>
        {model.name}
      </h3>
      <p className="text-[11px] text-text-tertiary font-mono mb-3 truncate" title={model.base_model ?? ""}>
        {model.base_model ?? "—"}
      </p>

      <div className="flex flex-wrap items-center gap-1.5 mb-3">
        {model.size_mb != null && (
          <span className="text-[10px] font-mono text-text-tertiary px-1.5 py-0.5 rounded bg-surface-2 border border-border-subtle">
            {model.size_mb.toFixed(1)} MB
          </span>
        )}
      </div>

      {model.metrics && Object.keys(model.metrics).length > 0 && (
        <div className="grid grid-cols-3 gap-2 mb-3 pb-3 border-b border-border-subtle">
          {["precision", "recall", "f1"].map((k) => {
            const v = model.metrics?.[k];
            return (
              <div key={k} className="flex flex-col">
                <span className="text-[9px] text-text-tertiary uppercase">{k.slice(0, 3)}</span>
                <span className="text-[13px] font-mono font-bold text-text-primary">
                  {typeof v === "number" ? v.toFixed(3) : "—"}
                </span>
              </div>
            );
          })}
        </div>
      )}

      <div
        className="mt-auto flex items-center justify-between gap-2"
        onClick={(e) => e.stopPropagation()}
      >
        <span className="text-[11px] text-text-tertiary">
          {model.created_at ? new Date(model.created_at).toLocaleDateString() : "—"}
        </span>
        <div className="flex items-center gap-1.5">
          <button
            onClick={onEval}
            disabled={evalBusy}
            className="flex items-center gap-1 px-2 py-1 rounded-md bg-surface-2 border border-border-default text-[11px] font-medium hover:text-accent hover:border-accent transition-colors disabled:opacity-50"
          >
            <Play className="w-3 h-3 fill-current" />
            {evalBusy ? "…" : "Eval"}
          </button>
          {!model.is_active && (
            <button
              onClick={onActivate}
              disabled={activating}
              className="px-2.5 py-1 rounded-md bg-accent text-white text-[11px] font-medium hover:opacity-90 disabled:opacity-50"
            >
              {activating ? "…" : "Активировать"}
            </button>
          )}
        </div>
      </div>

      {message && (
        <div className={cn(
          "mt-2 text-[11px] px-2 py-1.5 rounded",
          message.type === "success"
            ? "bg-[rgba(70,167,88,0.1)] text-status-success"
            : "bg-[rgba(229,72,77,0.1)] text-status-critical",
        )}>
          {message.text}
        </div>
      )}

      {evalResult && (
        <div className="mt-2 grid grid-cols-4 gap-1.5 text-[10px]">
          {["precision", "recall", "f1", "accuracy"].map((k) => (
            <div key={k} className="bg-surface-2 px-2 py-1 rounded border border-border-subtle">
              <div className="text-text-tertiary uppercase">{k.slice(0, 4)}</div>
              <div className="font-mono font-bold">
                {typeof evalResult[k] === "number" ? evalResult[k].toFixed(3) : "—"}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
