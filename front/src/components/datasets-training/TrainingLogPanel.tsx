/**
 * TrainingLogPanel — панель журнала обучения.
 *
 * Заменяет старый терминальный блок (bg-[#0A0D12] / text-[#A9DC76]).
 * Использует CSS-переменные design system ArgusGate (поддержка light/dark).
 * Источник данных: useTrainingLogStream (SSE для running, job.log_text для completed).
 */
import { useEffect, useRef, useState } from "react";
import { Copy, Lock, LockOpen, TerminalSquare } from "lucide-react";
import type { TrainingJob } from "@/api/types";
import { type LogEntry, type LogLevel, useTrainingLogStream } from "@/hooks/useTrainingLogStream";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Цветовая схема по уровню
// ---------------------------------------------------------------------------

interface LevelStyle {
  label: string;
  labelCls: string;
}

const LEVEL_STYLES: Record<LogLevel, LevelStyle> = {
  info:   { label: "INFO",   labelCls: "text-text-tertiary" },
  device: { label: "DEVICE", labelCls: "text-status-info" },
  data:   { label: "DATA",   labelCls: "text-text-secondary" },
  model:  { label: "MODEL",  labelCls: "text-text-secondary" },
  train:  { label: "TRAIN",  labelCls: "text-accent" },
  step:   { label: "STEP",   labelCls: "text-text-tertiary" },
  epoch:  { label: "EPOCH",  labelCls: "text-accent font-bold" },
  eval:   { label: "EVAL",   labelCls: "text-status-success" },
  done:   { label: "DONE",   labelCls: "text-status-success font-bold" },
  warn:   { label: "WARN",   labelCls: "text-status-warning" },
  error:  { label: "ERROR",  labelCls: "text-status-critical" },
};

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function LogLineRow({ entry }: { entry: LogEntry }) {
  const style = LEVEL_STYLES[entry.level] ?? LEVEL_STYLES.info;
  return (
    <div className="flex items-start gap-2 px-2 py-[2px]">
      {/* Timestamp */}
      <span className="text-text-tertiary text-[11px] w-16 shrink-0 tabular-nums select-none">
        {entry.ts}
      </span>
      {/* Level chip */}
      <span
        className={cn(
          "text-[11px] font-semibold w-[52px] shrink-0 uppercase",
          style.labelCls,
        )}
      >
        {style.label}
      </span>
      {/* Message */}
      <span
        className={cn(
          "text-text-primary break-all",
          entry.level === "step" && "text-text-tertiary",
        )}
      >
        {entry.message}
      </span>
    </div>
  );
}

function EmptyState({ job }: { job: TrainingJob }) {
  if (job.status === "queued") {
    return (
      <div className="text-text-tertiary text-[12px] px-2">
        В очереди... Логи появятся при старте обучения.
      </div>
    );
  }
  if (job.status === "running") {
    return (
      <div className="text-text-tertiary text-[12px] px-2 animate-pulse">
        Запуск обучения...
      </div>
    );
  }
  if (job.status === "failed") {
    return (
      <div className="text-status-critical text-[12px] px-2 font-mono">
        [ERROR] {job.error_message ?? "Задача завершилась ошибкой"}
      </div>
    );
  }
  return (
    <div className="text-text-tertiary text-[12px] px-2 font-mono">
      [INFO] Job {job.id} — status: {job.status}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

interface Props {
  job: TrainingJob;
}

export function TrainingLogPanel({ job }: Props) {
  const { entries, streaming } = useTrainingLogStream(job);
  const [autoScroll, setAutoScroll] = useState(true);
  const [copied, setCopied] = useState(false);

  const logEndRef = useRef<HTMLDivElement>(null);

  // Авто-прокрутка при появлении новых строк
  useEffect(() => {
    if (autoScroll && logEndRef.current) {
      logEndRef.current.scrollIntoView({ behavior: "instant" });
    }
  }, [entries.length, autoScroll]);

  const handleCopy = async () => {
    const text = entries.map((e) => e.line).join("\n");
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard API недоступна (HTTP) — тихо игнорируем
    }
  };

  return (
    <div className="bg-surface-1 border border-border-subtle rounded-xl flex flex-col overflow-hidden">
      {/* Заголовок панели */}
      <div className="px-4 py-3 border-b border-border-subtle flex items-center justify-between gap-2 shrink-0">
        <div className="flex items-center gap-2">
          <TerminalSquare className="w-4 h-4 text-text-secondary" />
          <h3 className="text-[12px] font-bold uppercase tracking-wider text-text-secondary">
            Журнал обучения
          </h3>
          {/* Индикатор live-стриминга */}
          {streaming && (
            <span className="flex items-center gap-1.5 text-[11px] text-status-success">
              <span className="w-1.5 h-1.5 rounded-full bg-status-success animate-pulse" />
              live
            </span>
          )}
          {/* Счётчик строк */}
          {entries.length > 0 && (
            <span className="text-[11px] text-text-tertiary tabular-nums">
              {entries.length} строк
            </span>
          )}
        </div>

        {/* Кнопки панели */}
        <div className="flex items-center gap-1">
          {/* Авто-прокрутка */}
          <button
            onClick={() => setAutoScroll((v) => !v)}
            title={autoScroll ? "Отключить автопрокрутку" : "Включить автопрокрутку"}
            className={cn(
              "p-1.5 rounded-md transition-colors",
              autoScroll
                ? "text-accent bg-accent/10 hover:bg-accent/20"
                : "text-text-tertiary hover:text-text-primary hover:bg-surface-3",
            )}
          >
            {autoScroll ? (
              <Lock className="w-3.5 h-3.5" />
            ) : (
              <LockOpen className="w-3.5 h-3.5" />
            )}
          </button>

          {/* Копировать */}
          <button
            onClick={handleCopy}
            disabled={entries.length === 0}
            title="Копировать весь лог"
            className="p-1.5 rounded-md text-text-tertiary hover:text-text-primary hover:bg-surface-3 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <Copy className="w-3.5 h-3.5" />
          </button>
          {copied && (
            <span className="text-[11px] text-status-success">✓</span>
          )}
        </div>
      </div>

      {/* Тело лога */}
      <div className="flex-1 bg-surface-2/50 p-3 overflow-y-auto font-mono text-[12px] leading-relaxed min-h-[200px] max-h-[380px]">
        {entries.length === 0 ? (
          <EmptyState job={job} />
        ) : (
          <>
            {entries.map((entry) => (
              <LogLineRow key={entry.id} entry={entry} />
            ))}
          </>
        )}
        {/* Якорь для авто-прокрутки */}
        <div ref={logEndRef} />
      </div>
    </div>
  );
}
