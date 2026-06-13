import { useEffect, useState } from "react";
import { api } from "@/api/client";
import type {
  DevicePref,
  DeviceState,
  DeviceTarget,
  SetDeviceResult,
} from "@/api/types";
import { clearDeviceCache, fetchDeviceState } from "@/lib/deviceFetch";
import { DeviceSelector } from "@/components/datasets-training/DeviceSelector";
import { cn } from "@/lib/utils";

interface Props {
  target: DeviceTarget;
  title: string;
  onApplied?: (state: DeviceState) => void;
}

/**
 * Карточка управления выбором устройства (CPU/GPU) для одного из target'ов:
 * - layer4 — inference Layer 4
 * - training — LoRA-обучение
 */
export function DeviceCard({ target, title, onApplied }: Props) {
  const [state, setState] = useState<DeviceState | null>(null);
  const [draft, setDraft] = useState<DevicePref>("auto");
  const [loading, setLoading] = useState(true);
  const [applying, setApplying] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  useEffect(() => {
    fetchDeviceState(true)
      .then((s) => {
        setState(s);
        setDraft(s[target].pref);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [target]);

  const targetState = state ? state[target] : null;
  const changed = targetState ? draft !== targetState.pref : false;

  const selectorState = state && targetState
    ? {
        cuda_available: state.cuda_available,
        cuda_device_name: state.cuda_device_name,
        resolved: targetState.resolved,
        fallback_reason: targetState.fallback_reason,
      }
    : null;

  const apply = async () => {
    if (!changed) return;
    setApplying(true);
    setMessage(null);
    try {
      const res = await api.post<SetDeviceResult>("/system/device", { target, pref: draft });
      clearDeviceCache();
      setState(res.state);
      setDraft(res.state[target].pref);
      const reactivated =
        target === "layer4" && res.adapter_reactivated ? " · адаптер переактивирован" : "";
      setMessage({
        type: "success",
        text: res.state[target].fallback_reason
          ? `${res.state[target].fallback_reason}${reactivated}`
          : `Устройство: ${res.state[target].resolved}${reactivated}`,
      });
      onApplied?.(res.state);
    } catch (e: any) {
      setMessage({ type: "error", text: e?.message ?? "Не удалось применить" });
    } finally {
      setApplying(false);
    }
  };

  return (
    <div className="bg-surface-1 border border-border-subtle rounded-xl p-5 flex flex-col gap-4 shadow-sm">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-[13px] font-semibold text-text-primary">{title}</h3>
        {targetState && (
          <span className="text-[11px] text-text-tertiary font-mono">
            preference: {targetState.pref}
          </span>
        )}
      </div>

      {loading || !state || !targetState || !selectorState ? (
        <div className="h-20 bg-surface-2 rounded-md animate-pulse" />
      ) : (
        <>
          <DeviceSelector
            state={selectorState}
            value={draft}
            onChange={setDraft}
            disabled={applying}
          />

          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] text-text-tertiary">
              {applying
                ? target === "layer4"
                  ? "перезагрузка модели…"
                  : "сохранение…"
                : changed
                ? "не сохранено"
                : "сохранено"}
            </span>
            <button
              onClick={apply}
              disabled={!changed || applying}
              className="px-4 py-1.5 rounded-md bg-accent text-white text-[13px] font-medium hover:opacity-90 disabled:opacity-40"
            >
              {applying ? "…" : "Применить"}
            </button>
          </div>

          {message && (
            <div
              className={cn(
                "text-[12px] px-3 py-2 rounded-md",
                message.type === "success"
                  ? "bg-[rgba(70,167,88,0.1)] text-status-success"
                  : "bg-[rgba(229,72,77,0.1)] text-status-critical",
              )}
            >
              {message.text}
            </div>
          )}
        </>
      )}
    </div>
  );
}
