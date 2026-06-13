import { useMemo } from "react";
import { cn } from "@/lib/utils";
import type { Dataset } from "@/api/types";

interface Props {
  dataset: Dataset;
  className?: string;
}

interface BarSeg {
  key: string;
  value: number;
  className: string;
  label: string;
}

const SPLIT_COLORS: Record<string, string> = {
  train: "bg-accent",
  val: "bg-status-warning",
  test: "bg-status-success",
};

const LABEL_COLORS: Record<string, string> = {
  attack: "bg-status-critical",
  benign: "bg-status-success",
  unknown: "bg-surface-3",
};

// Локализация API-ключей лейблов
const LABEL_NAMES: Record<string, string> = {
  attack:  "Атака",
  benign:  "Норма",
  unknown: "Неизвестно",
};

function StackedBar({ segments }: { segments: BarSeg[] }) {
  const total = segments.reduce((acc, s) => acc + s.value, 0);
  if (total === 0) {
    return <div className="h-1.5 rounded-full bg-surface-3" />;
  }
  return (
    <div className="h-1.5 rounded-full bg-surface-3 overflow-hidden flex">
      {segments.map((s) => (
        <div
          key={s.key}
          className={s.className}
          style={{ width: `${(s.value / total) * 100}%` }}
          title={`${s.label}: ${s.value}`}
        />
      ))}
    </div>
  );
}

function StatLine({
  title,
  segments,
  className,
}: {
  title: string;
  segments: BarSeg[];
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <div className="flex items-center justify-between text-[11px]">
        <span className="font-mono text-text-tertiary uppercase tracking-wider">{title}</span>
        <span className="flex flex-wrap gap-x-3 gap-y-0.5 justify-end">
          {segments.filter((s) => s.value > 0).map((s) => (
            <span key={s.key} className="font-mono">
              <span className="text-text-secondary">{s.label}</span>
              <span className="text-text-primary"> {s.value}</span>
            </span>
          ))}
        </span>
      </div>
      <StackedBar segments={segments} />
    </div>
  );
}

export function DatasetDistributionPanel({ dataset, className }: Props) {
  const splitSegments = useMemo<BarSeg[]>(() => ([
    { key: "train", label: "Обучение",   value: dataset.train_count ?? 0, className: SPLIT_COLORS.train },
    { key: "val",   label: "Валидация",  value: dataset.val_count   ?? 0, className: SPLIT_COLORS.val },
    { key: "test",  label: "Тест",       value: dataset.test_count  ?? 0, className: SPLIT_COLORS.test },
  ]), [dataset.train_count, dataset.val_count, dataset.test_count]);

  const labelSegments = useMemo<BarSeg[]>(() => {
    const labels = dataset.labels ?? {};
    return Object.entries(labels).map(([k, v]) => ({
      key: k,
      label: LABEL_NAMES[k] ?? k,
      value: v,
      className: LABEL_COLORS[k] ?? "bg-surface-3",
    }));
  }, [dataset.labels]);

  const topCategories = useMemo(() => {
    const entries = Object.entries(dataset.categories ?? {});
    entries.sort((a, b) => b[1] - a[1]);
    return entries.slice(0, 5);
  }, [dataset.categories]);

  return (
    <div className={cn("flex flex-col gap-4", className)}>
      <StatLine title="Разбивка" segments={splitSegments} />
      {labelSegments.length > 0 && <StatLine title="Метки" segments={labelSegments} />}
      {topCategories.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <div className="text-[11px] font-mono text-text-tertiary uppercase tracking-wider">Категории</div>
          <div className="flex flex-wrap gap-1.5">
            {topCategories.map(([cat, count]) => (
              <span
                key={cat}
                className="inline-flex items-baseline gap-1.5 px-2 py-0.5 rounded bg-surface-2 border border-border-subtle text-[11px]"
              >
                <span className="text-text-secondary">{cat}</span>
                <span className="font-mono text-text-primary">{count}</span>
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
