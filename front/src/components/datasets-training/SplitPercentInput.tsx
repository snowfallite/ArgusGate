import { cn } from "@/lib/utils";

interface Props {
  train: number;
  val: number;
  test: number;
  onChange: (parts: { train: number; val: number; test: number }) => void;
  disabled?: boolean;
}

export function SplitPercentInput({ train, val, test, onChange, disabled }: Props) {
  const sum = train + val + test;
  const valid = sum === 100;

  const set = (key: "train" | "val" | "test", value: number) => {
    const clamped = Math.max(0, Math.min(100, Math.round(value)));
    onChange({ train, val, test, [key]: clamped });
  };

  return (
    <div className="flex flex-col gap-1.5">
      <div className="grid grid-cols-3 gap-2">
        {(["train", "val", "test"] as const).map((key) => (
          <div key={key} className="flex flex-col gap-1">
            <label className="text-[11px] font-mono text-text-tertiary uppercase">{key}</label>
            <div className="relative">
              <input
                type="number"
                value={key === "train" ? train : key === "val" ? val : test}
                onChange={(e) => set(key, Number(e.target.value))}
                min={0}
                max={100}
                step={1}
                disabled={disabled}
                className={cn(
                  "w-full bg-surface-2 border rounded-lg pl-3 pr-7 py-2 text-[13px] font-mono focus:outline-none disabled:opacity-50",
                  valid ? "border-border-default focus:border-accent" : "border-status-warning",
                )}
              />
              <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[11px] text-text-tertiary pointer-events-none">%</span>
            </div>
          </div>
        ))}
      </div>
      <div className={cn(
        "text-[11px] font-mono",
        valid ? "text-text-tertiary" : "text-status-warning",
      )}>
        Σ = {sum}%
      </div>
    </div>
  );
}

export function isValidSplit(train: number, val: number, test: number): boolean {
  return train + val + test === 100;
}
