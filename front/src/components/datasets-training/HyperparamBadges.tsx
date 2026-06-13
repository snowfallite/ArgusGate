import { formatHyperparam, HYPERPARAMS, type HyperparamKey } from "@/lib/hyperparams";
import { cn } from "@/lib/utils";

interface Props {
  hyperparameters: Record<string, number> | null | undefined;
  className?: string;
}

const ORDER: HyperparamKey[] = ["lora_r", "lora_alpha", "epochs", "learning_rate"];
const SHORT: Record<HyperparamKey, string> = {
  lora_r: "r",
  lora_alpha: "α",
  epochs: "ep",
  learning_rate: "lr",
};

export function HyperparamBadges({ hyperparameters, className }: Props) {
  if (!hyperparameters) return null;

  return (
    <div className={cn("flex flex-wrap items-center gap-1.5", className)}>
      {ORDER.filter((k) => hyperparameters[k] != null).map((k) => {
        const meta = HYPERPARAMS[k];
        const value = hyperparameters[k];
        return (
          <span
            key={k}
            className="inline-flex items-baseline gap-1 px-1.5 py-0.5 rounded bg-surface-2 border border-border-subtle text-[10px] font-mono"
          >
            <span className="text-text-tertiary">{SHORT[k]}</span>
            <span className="text-text-primary">{formatHyperparam(meta, value)}</span>
          </span>
        );
      })}
    </div>
  );
}
