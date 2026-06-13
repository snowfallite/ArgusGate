import { useEffect } from "react";
import { X, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

export type ConfirmVariant = "danger" | "warning" | "info";

interface Props {
  open: boolean;
  title: string;
  body?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: ConfirmVariant;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

const VARIANT_COLOR: Record<ConfirmVariant, string> = {
  danger: "var(--status-critical)",
  warning: "var(--status-warning)",
  info: "var(--accent)",
};

const VARIANT_BTN: Record<ConfirmVariant, string> = {
  danger: "bg-status-critical hover:opacity-90 text-white",
  warning: "bg-status-warning hover:opacity-90 text-white",
  info: "bg-accent hover:opacity-90 text-white",
};

export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel = "Подтвердить",
  cancelLabel = "Отмена",
  variant = "danger",
  busy = false,
  onConfirm,
  onCancel,
}: Props) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onCancel();
      else if (e.key === "Enter" && !busy) onConfirm();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, busy, onCancel, onConfirm]);

  if (!open) return null;

  const accent = VARIANT_COLOR[variant];

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center"
      style={{
        paddingTop: "var(--topbar-h, 72px)",
        paddingBottom: "16px",
        paddingLeft: "calc(var(--sidebar-w, 280px) + 16px)",
        paddingRight: "16px",
      }}
    >
      <div
        className="absolute inset-0 bg-black/50"
        style={{ backdropFilter: "blur(3px)" }}
        onClick={!busy ? onCancel : undefined}
      />

      <div
        className="relative w-full max-w-[460px] bg-surface-1 rounded-2xl shadow-2xl flex flex-col overflow-hidden"
        style={{ border: "1px solid var(--border-subtle)" }}
      >
        <div className="h-1 w-full shrink-0" style={{ background: accent, opacity: 0.7 }} />

        <div className="flex items-start justify-between px-5 py-4 bg-surface-2 shrink-0 gap-3">
          <div className="flex items-start gap-2.5">
            <div
              className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
              style={{ background: `${accent}1F`, color: accent, border: `1px solid ${accent}33` }}
            >
              <AlertTriangle className="w-4 h-4" />
            </div>
            <h3 className="text-[14px] font-semibold text-text-primary leading-snug pt-1">{title}</h3>
          </div>
          <button
            onClick={onCancel}
            disabled={busy}
            className="p-1.5 rounded-lg text-text-secondary hover:bg-surface-3 hover:text-text-primary transition-colors disabled:opacity-40"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {body && (
          <div className="px-5 py-4 text-[13px] text-text-secondary leading-relaxed">
            {body}
          </div>
        )}

        <div className="flex items-center justify-end gap-2 px-5 py-3 bg-surface-2 border-t border-border-subtle">
          <button
            onClick={onCancel}
            disabled={busy}
            className="px-3.5 py-1.5 rounded-md text-[13px] text-text-secondary hover:text-text-primary hover:bg-surface-3 disabled:opacity-40"
          >
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            disabled={busy}
            className={cn(
              "px-4 py-1.5 rounded-md text-[13px] font-medium transition-opacity disabled:opacity-50",
              VARIANT_BTN[variant]
            )}
          >
            {busy ? "..." : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
