import { Cpu, MonitorCog, Server } from "lucide-react";
import type { DevicePref } from "@/api/types";
import { cn } from "@/lib/utils";
import { Tooltip } from "./Tooltip";

interface Option {
  value: DevicePref;
  label: string;
  icon: typeof Cpu;
}

const OPTIONS: Option[] = [
  { value: "auto", label: "Auto", icon: MonitorCog },
  { value: "cpu", label: "CPU", icon: Cpu },
  { value: "cuda", label: "GPU", icon: Server },
];

export interface DeviceSelectorState {
  cuda_available: boolean;
  cuda_device_name: string | null;
  resolved: "cpu" | "cuda";
  fallback_reason: string | null;
}

interface Props {
  state: DeviceSelectorState;
  value: DevicePref;
  onChange: (next: DevicePref) => void;
  disabled?: boolean;
  className?: string;
}

export function DeviceSelector({ state, value, onChange, disabled, className }: Props) {
  const cudaAvailable = state.cuda_available;

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <div className="grid grid-cols-3 gap-1.5">
        {OPTIONS.map((opt) => {
          const Icon = opt.icon;
          const isGpu = opt.value === "cuda";
          const optionDisabled = disabled || (isGpu && !cudaAvailable);
          const button = (
            <button
              key={opt.value}
              type="button"
              disabled={optionDisabled}
              onClick={() => onChange(opt.value)}
              className={cn(
                "w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-md border text-[12px] font-medium transition-colors",
                value === opt.value
                  ? "bg-accent/15 text-accent border-accent/40"
                  : "bg-surface-2 text-text-secondary border-border-default hover:text-text-primary",
                optionDisabled && "opacity-40 cursor-not-allowed hover:text-text-secondary",
              )}
            >
              <Icon className="w-3.5 h-3.5" />
              {opt.label}
            </button>
          );
          if (isGpu && !cudaAvailable) {
            return (
              <Tooltip
                key={opt.value}
                content="CUDA недоступна в этом окружении. Чтобы включить GPU — пересоберите backend-образ с CUDA-вариантом PyTorch и запустите через nvidia-docker."
                maxWidth={300}
              >
                <span className="block">{button}</span>
              </Tooltip>
            );
          }
          return button;
        })}
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] font-mono">
        <span className="text-text-tertiary">актуально</span>
        <span className={cn(
          "px-1.5 py-0.5 rounded",
          state.resolved === "cuda"
            ? "bg-status-success/15 text-status-success"
            : "bg-surface-2 text-text-secondary",
        )}>
          {state.resolved}
        </span>
        {state.cuda_device_name && (
          <span className="text-text-tertiary truncate" title={state.cuda_device_name}>
            {state.cuda_device_name}
          </span>
        )}
        {!cudaAvailable && (
          <span className="text-text-tertiary">CUDA недоступна</span>
        )}
      </div>

      {state.fallback_reason && (
        <div className="text-[11px] px-2 py-1.5 rounded bg-[rgba(245,166,35,0.08)] border border-[rgba(245,166,35,0.25)] text-status-warning">
          {state.fallback_reason}
        </div>
      )}
    </div>
  );
}
