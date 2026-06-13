import { useEffect, useMemo, useState } from "react";
import { api } from "@/api/client";
import type {
  AuditLabel,
  CreateFromAuditPayload,
  Dataset,
  FromAuditPreview,
} from "@/api/types";
import { fetchAuditCategories } from "@/lib/auditCategoryFetch";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { cn } from "@/lib/utils";
import { Modal } from "./Modal";
import { SplitPercentInput, isValidSplit } from "./SplitPercentInput";

interface Props {
  open: boolean;
  onClose: () => void;
  onCreated: (dataset: Dataset) => void;
}

const LABELS: { value: AuditLabel; title: string }[] = [
  { value: "confirmed_attack", title: "confirmed_attack" },
  { value: "false_positive", title: "false_positive" },
  { value: "uncertain", title: "uncertain" },
];

function toIsoOrNull(value: string): string | null {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

export function CreateFromAuditModal({ open, onClose, onCreated }: Props) {
  const [name, setName] = useState("");
  const [maxSamples, setMaxSamples] = useState(500);
  const [labelFilter, setLabelFilter] = useState<AuditLabel[]>([
    "confirmed_attack",
    "false_positive",
  ]);
  const [categories, setCategories] = useState<string[]>([]);
  const [allCategories, setAllCategories] = useState<string[]>([]);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [trainPct, setTrainPct] = useState(70);
  const [valPct, setValPct] = useState(15);
  const [testPct, setTestPct] = useState(15);

  const [preview, setPreview] = useState<FromAuditPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    fetchAuditCategories().then(setAllCategories).catch(() => setAllCategories([]));
  }, [open]);

  useEffect(() => {
    if (!open) {
      setName("");
      setError(null);
      setPreview(null);
      setLabelFilter(["confirmed_attack", "false_positive"]);
      setCategories([]);
      setDateFrom("");
      setDateTo("");
      setMaxSamples(500);
      setTrainPct(70);
      setValPct(15);
      setTestPct(15);
    }
  }, [open]);

  const previewKey = useMemo(
    () =>
      JSON.stringify({
        labelFilter,
        categories,
        dateFrom,
        dateTo,
        maxSamples,
      }),
    [labelFilter, categories, dateFrom, dateTo, maxSamples],
  );
  const debouncedKey = useDebouncedValue(previewKey, 400);

  useEffect(() => {
    if (!open) return;
    if (labelFilter.length === 0) {
      setPreview(null);
      return;
    }
    let cancelled = false;
    setPreviewLoading(true);
    api
      .post<FromAuditPreview>("/datasets/from-audit/preview", {
        label_filter: labelFilter,
        categories: categories.length ? categories : null,
        date_from: toIsoOrNull(dateFrom),
        date_to: toIsoOrNull(dateTo),
        max_samples: maxSamples,
      })
      .then((r) => {
        if (!cancelled) setPreview(r);
      })
      .catch((e: any) => {
        if (!cancelled) {
          setPreview(null);
          setError(e?.message ?? "preview failed");
        }
      })
      .finally(() => {
        if (!cancelled) setPreviewLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [debouncedKey, open]);

  const toggleLabel = (l: AuditLabel) => {
    setLabelFilter((cur) => (cur.includes(l) ? cur.filter((x) => x !== l) : [...cur, l]));
  };
  const toggleCategory = (c: string) => {
    setCategories((cur) => (cur.includes(c) ? cur.filter((x) => x !== c) : [...cur, c]));
  };

  const valid =
    name.trim().length > 0 &&
    labelFilter.length > 0 &&
    isValidSplit(trainPct, valPct, testPct) &&
    (preview?.applicable ?? 0) > 0;

  const handleCreate = async () => {
    if (!valid) return;
    setCreating(true);
    setError(null);
    try {
      const payload: CreateFromAuditPayload = {
        name: name.trim(),
        label_filter: labelFilter,
        max_samples: maxSamples,
        date_from: toIsoOrNull(dateFrom),
        date_to: toIsoOrNull(dateTo),
        categories: categories.length ? categories : null,
        train_pct: trainPct / 100,
        val_pct: valPct / 100,
        test_pct: testPct / 100,
      };
      const created = await api.post<Dataset>("/datasets/from-audit", payload);
      onCreated(created);
      onClose();
    } catch (e: any) {
      setError(e?.message ?? "Не удалось создать датасет");
    } finally {
      setCreating(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Новый датасет из аудита"
      maxWidth="max-w-2xl"
      footer={
        <>
          <button
            onClick={onClose}
            disabled={creating}
            className="px-3.5 py-1.5 rounded-md text-[13px] text-text-secondary hover:text-text-primary hover:bg-surface-3 disabled:opacity-40"
          >
            Отмена
          </button>
          <button
            onClick={handleCreate}
            disabled={!valid || creating}
            className="px-4 py-1.5 rounded-md text-[13px] font-medium bg-accent text-white hover:opacity-90 disabled:opacity-40"
          >
            {creating ? "..." : "Создать"}
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="text-[12px] text-text-secondary leading-snug">
          Извлекает размеченные события из журнала аудита (подтверждённые атаки + ложные срабатывания) в обучающий датасет.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <label className="text-[12px] font-medium text-text-secondary">Название</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={200}
              className="bg-surface-2 border border-border-default rounded-lg px-3 py-2 text-[13px] focus:outline-none focus:border-accent"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-[12px] font-medium text-text-secondary">Макс. образцов</label>
            <input
              type="number"
              value={maxSamples}
              onChange={(e) => setMaxSamples(Math.max(1, Number(e.target.value) || 0))}
              min={1}
              max={100000}
              className="bg-surface-2 border border-border-default rounded-lg px-3 py-2 text-[13px] focus:outline-none focus:border-accent"
            />
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-[12px] font-medium text-text-secondary">Метки</label>
          <div className="flex flex-wrap gap-1.5">
            {LABELS.map((l) => {
              const active = labelFilter.includes(l.value);
              return (
                <button
                  key={l.value}
                  type="button"
                  onClick={() => toggleLabel(l.value)}
                  className={cn(
                    "px-2.5 py-1 rounded-md text-[11px] font-mono border transition-colors",
                    active
                      ? "bg-accent/15 text-accent border-accent/40"
                      : "bg-surface-2 text-text-secondary border-border-default hover:text-text-primary",
                  )}
                >
                  {l.title}
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-[12px] font-medium text-text-secondary">Категории</label>
          <div className="flex flex-wrap gap-1.5">
            {allCategories.map((c) => {
              const active = categories.includes(c);
              return (
                <button
                  key={c}
                  type="button"
                  onClick={() => toggleCategory(c)}
                  className={cn(
                    "px-2 py-0.5 rounded text-[11px] font-mono border transition-colors",
                    active
                      ? "bg-accent/15 text-accent border-accent/40"
                      : "bg-surface-2 text-text-secondary border-border-default hover:text-text-primary",
                  )}
                >
                  {c}
                </button>
              );
            })}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <label className="text-[12px] font-medium text-text-secondary">Дата с</label>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="bg-surface-2 border border-border-default rounded-lg px-3 py-2 text-[13px] focus:outline-none focus:border-accent"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-[12px] font-medium text-text-secondary">Дата по</label>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="bg-surface-2 border border-border-default rounded-lg px-3 py-2 text-[13px] focus:outline-none focus:border-accent"
            />
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-[12px] font-medium text-text-secondary">Train / Val / Test</label>
          <SplitPercentInput
            train={trainPct}
            val={valPct}
            test={testPct}
            onChange={({ train, val, test }) => {
              setTrainPct(train);
              setValPct(val);
              setTestPct(test);
            }}
          />
        </div>

        <div className="bg-surface-2 border border-border-subtle rounded-lg p-3 flex flex-col gap-1.5">
          {previewLoading && !preview ? (
            <span className="text-[12px] text-text-tertiary font-mono">…</span>
          ) : preview ? (
            <>
              <div className="text-[12px] font-mono text-text-primary">
                <span className="text-text-tertiary">найдено </span>
                <span>{preview.total_matching}</span>
                <span className="text-text-tertiary"> · с текстом </span>
                <span>{preview.with_text}</span>
                <span className="text-text-tertiary"> · попадёт </span>
                <span className="text-accent">{preview.applicable}</span>
              </div>
              {Object.keys(preview.by_label).length > 0 && (
                <div className="text-[11px] font-mono text-text-secondary flex flex-wrap gap-x-3">
                  {Object.entries(preview.by_label).map(([k, v]) => (
                    <span key={k}>
                      <span className="text-text-tertiary">{k} </span>
                      {v}
                    </span>
                  ))}
                </div>
              )}
              {Object.keys(preview.by_category).length > 0 && (
                <div className="text-[11px] font-mono text-text-secondary flex flex-wrap gap-x-3">
                  {Object.entries(preview.by_category).map(([k, v]) => (
                    <span key={k}>
                      <span className="text-text-tertiary">{k} </span>
                      {v}
                    </span>
                  ))}
                </div>
              )}
            </>
          ) : (
            <span className="text-[12px] text-text-tertiary font-mono">укажите фильтры</span>
          )}
        </div>

        {error && <p className="text-[12px] text-status-critical">{error}</p>}
      </div>
    </Modal>
  );
}
