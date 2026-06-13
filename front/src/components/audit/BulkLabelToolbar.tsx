import { useState, useEffect } from "react";
import { ShieldAlert, ShieldCheck, HelpCircle, X, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { api } from "@/api/client";

export type LabelKind = "confirmed_attack" | "false_positive" | "uncertain";

const LABEL_OPTIONS: { value: LabelKind; label: string; color: string; icon: React.ReactNode }[] = [
  { value: "confirmed_attack", label: "Атака", color: "var(--status-critical)", icon: <ShieldAlert className="w-3.5 h-3.5" /> },
  { value: "false_positive", label: "Ложное срабатывание", color: "var(--status-success)", icon: <ShieldCheck className="w-3.5 h-3.5" /> },
  { value: "uncertain", label: "Неопределённо", color: "var(--status-warning)", icon: <HelpCircle className="w-3.5 h-3.5" /> },
];

interface Props {
  selectedIds: string[];
  onClear: () => void;
  onApplied: (count: number) => void;
}

export function BulkLabelToolbar({ selectedIds, onClear, onApplied }: Props) {
  const [label, setLabel] = useState<LabelKind>("confirmed_attack");
  const [category, setCategory] = useState("");
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [categories, setCategories] = useState<string[]>([]);

  useEffect(() => {
    api.get<{ categories: string[] }>("/audit/categories")
      .then(res => setCategories(res.categories))
      .catch(() => {});
  }, []);

  const submit = async () => {
    if (selectedIds.length === 0) return;
    setSubmitting(true);
    setError("");
    try {
      const res = await api.post<{ updated: number }>("/audit/bulk-label", {
        event_ids: selectedIds,
        label,
        label_category: category || null,
        label_comment: comment || null,
      });
      onApplied(res.updated);
      setCategory("");
      setComment("");
    } catch (e: any) {
      setError(e.message || "Не удалось разметить");
    }
    setSubmitting(false);
  };

  return (
    <div className="sticky top-0 z-20 flex flex-col gap-3 p-4 bg-surface-2 border border-accent border-opacity-40 rounded-xl shadow-lg">
      <div className="flex items-center gap-3">
        <span className="inline-flex items-center gap-2 px-2 py-1 rounded-md bg-accent text-white text-[12px] font-medium">
          <Check className="w-3.5 h-3.5" />
          Выбрано: {selectedIds.length}
        </span>

        <div className="flex items-center gap-1">
          {LABEL_OPTIONS.map(opt => (
            <button
              key={opt.value}
              onClick={() => setLabel(opt.value)}
              className={cn(
                "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] border transition-colors",
                label === opt.value
                  ? "border-current"
                  : "border-border-default bg-surface-1 text-text-secondary hover:bg-surface-3"
              )}
              style={label === opt.value ? { color: opt.color, background: `${opt.color}1A` } : undefined}
            >
              {opt.icon}
              {opt.label}
            </button>
          ))}
        </div>

        <input
          list="bulk-categories"
          value={category}
          onChange={e => setCategory(e.target.value)}
          placeholder="Категория (опц.)"
          className="flex-1 max-w-[200px] bg-surface-1 border border-border-default rounded-md px-3 py-1.5 text-[12px] focus:outline-none focus:border-accent"
        />
        <datalist id="bulk-categories">
          {categories.map(c => <option key={c} value={c} />)}
        </datalist>

        <input
          value={comment}
          onChange={e => setComment(e.target.value)}
          placeholder="Комментарий (опц.)"
          className="flex-1 max-w-[260px] bg-surface-1 border border-border-default rounded-md px-3 py-1.5 text-[12px] focus:outline-none focus:border-accent"
        />

        <button
          onClick={submit}
          disabled={submitting || selectedIds.length === 0}
          className="px-3 py-1.5 bg-accent text-white rounded-md text-[12px] font-medium hover:opacity-90 disabled:opacity-50"
        >
          {submitting ? "Сохранение…" : "Применить"}
        </button>

        <button
          onClick={onClear}
          className="p-1.5 rounded-md text-text-tertiary hover:text-status-critical hover:bg-surface-3"
          title="Сбросить выбор"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {error && (
        <div className="text-[12px] text-status-critical px-3 py-1.5 rounded-md bg-[rgba(229,72,77,0.08)]">
          {error}
        </div>
      )}
    </div>
  );
}
