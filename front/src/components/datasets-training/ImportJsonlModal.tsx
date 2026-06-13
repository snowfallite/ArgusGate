import { useEffect, useState } from "react";
import { api } from "@/api/client";
import type { Dataset } from "@/api/types";
import { cn } from "@/lib/utils";
import { Modal } from "./Modal";
import { SplitPercentInput, isValidSplit } from "./SplitPercentInput";

interface Props {
  open: boolean;
  onClose: () => void;
  onCreated: (dataset: Dataset) => void;
}

interface ImportReport {
  dataset_id: string;
  imported: number;
  skipped_invalid_json: number;
  skipped_invalid_label: number;
  errors: { line: number; reason: string }[];
}

export function ImportJsonlModal({ open, onClose, onCreated }: Props) {
  const [name, setName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [trainPct, setTrainPct] = useState(70);
  const [valPct, setValPct] = useState(15);
  const [testPct, setTestPct] = useState(15);
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setName("");
      setFile(null);
      setTrainPct(70);
      setValPct(15);
      setTestPct(15);
      setReport(null);
      setError(null);
    }
  }, [open]);

  const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 МБ

  const valid =
    name.trim().length > 0 && file !== null && isValidSplit(trainPct, valPct, testPct);

  const handleUpload = async () => {
    if (!valid || !file) return;
    if (file.size > MAX_FILE_SIZE) {
      setError(`Файл слишком большой. Максимум — 50 МБ, у вас — ${(file.size / 1024 / 1024).toFixed(1)} МБ`);
      return;
    }
    setBusy(true);
    setError(null);
    setReport(null);
    try {
      const form = new FormData();
      form.append("name", name.trim());
      form.append("file", file);
      form.append("train_pct", (trainPct / 100).toString());
      form.append("val_pct", (valPct / 100).toString());
      form.append("test_pct", (testPct / 100).toString());
      const r = await api.upload<ImportReport>("/datasets/import", form);
      setReport(r);
      const fresh = await api.get<Dataset[]>("/datasets");
      const created = fresh.find((d) => d.id === r.dataset_id);
      if (created) onCreated(created);
    } catch (e: any) {
      setError(e?.message ?? "Upload failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Импорт JSONL"
      maxWidth="max-w-2xl"
      footer={
        <>
          <button
            onClick={onClose}
            disabled={busy}
            className="px-3.5 py-1.5 rounded-md text-[13px] text-text-secondary hover:text-text-primary hover:bg-surface-3 disabled:opacity-40"
          >
            {report ? "Закрыть" : "Отмена"}
          </button>
          {!report && (
            <button
              onClick={handleUpload}
              disabled={!valid || busy}
              className="px-4 py-1.5 rounded-md text-[13px] font-medium bg-accent text-white hover:opacity-90 disabled:opacity-40"
            >
              {busy ? "..." : "Загрузить"}
            </button>
          )}
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <label className="text-[12px] font-medium text-text-secondary">Название</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={200}
              disabled={busy || !!report}
              className="bg-surface-2 border border-border-default rounded-lg px-3 py-2 text-[13px] focus:outline-none focus:border-accent"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-[12px] font-medium text-text-secondary">Файл (.jsonl)</label>
            <input
              type="file"
              accept=".jsonl,.json"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              disabled={busy || !!report}
              className="bg-surface-2 border border-border-default rounded-lg px-3 py-2 text-[12px] focus:outline-none text-text-secondary file:mr-2 file:bg-surface-3 file:border-0 file:rounded file:px-2 file:py-0.5 file:text-[11px] file:text-text-primary cursor-pointer"
            />
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-[12px] font-medium text-text-secondary">Train / Val / Test</label>
          <SplitPercentInput
            train={trainPct}
            val={valPct}
            test={testPct}
            disabled={busy || !!report}
            onChange={({ train, val, test }) => {
              setTrainPct(train);
              setValPct(val);
              setTestPct(test);
            }}
          />
        </div>

        {report && (
          <div className={cn(
            "p-3 rounded-md border flex flex-col gap-2",
            report.imported > 0
              ? "bg-[rgba(70,167,88,0.08)] border-[rgba(70,167,88,0.25)]"
              : "bg-[rgba(245,166,35,0.08)] border-[rgba(245,166,35,0.25)]",
          )}>
            <div className="flex items-center gap-3 text-[12px] font-mono">
              <span className="text-status-success">imported {report.imported}</span>
              {report.skipped_invalid_json > 0 && (
                <span className="text-status-warning">json {report.skipped_invalid_json}</span>
              )}
              {report.skipped_invalid_label > 0 && (
                <span className="text-status-warning">label {report.skipped_invalid_label}</span>
              )}
            </div>
            {report.errors && report.errors.length > 0 && (
              <details className="text-[11px] text-text-tertiary">
                <summary className="cursor-pointer">{report.errors.length} строк с ошибками</summary>
                <ul className="mt-1 max-h-32 overflow-y-auto font-mono">
                  {report.errors.map((e, i) => (
                    <li key={i}>стр. {e.line}: {e.reason}</li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        )}

        {error && <p className="text-[12px] text-status-critical">{error}</p>}
      </div>
    </Modal>
  );
}
