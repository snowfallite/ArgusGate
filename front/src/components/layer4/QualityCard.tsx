import { Link } from "react-router-dom";
import { Target, AlertTriangle, ExternalLink } from "lucide-react";

interface FalsePositive {
  event_id: string;
  score: number;
  request_text: string;
  labeled_at: string | null;
}

export interface QualityData {
  total_labeled: number;
  by_label: { confirmed_attack: number; false_positive: number; uncertain: number };
  tp: number;
  fp: number;
  tn: number;
  fn: number;
  precision: number | null;
  recall: number | null;
  f1: number | null;
  top_false_positives: FalsePositive[];
}

interface Props {
  data: QualityData | null;
  loading: boolean;
}

function Metric({ label, value, color }: { label: string; value: number | null; color: string }) {
  return (
    <div className="bg-surface-2 border border-border-subtle rounded-md px-3 py-2 flex flex-col gap-0.5">
      <span className="text-[10px] uppercase tracking-wider text-text-tertiary font-medium">{label}</span>
      <span className="text-[18px] font-mono font-bold" style={{ color }}>
        {value !== null ? value.toFixed(3) : "—"}
      </span>
    </div>
  );
}

export function QualityCard({ data, loading }: Props) {
  if (loading) {
    return <div className="content-card h-64 bg-surface-2 animate-pulse" />;
  }

  if (!data || data.total_labeled < 1) {
    return (
      <div className="content-card flex flex-col gap-3">
        <h3 className="text-body-strong flex items-center gap-2">
          <Target className="w-4 h-4" /> Качество на размеченных
        </h3>
        <div className="flex flex-col items-center justify-center gap-3 py-8 text-text-tertiary text-center">
          <AlertTriangle className="w-8 h-8 opacity-30" />
          <span className="text-[12px]">
            Нет размеченных событий L4.
            <br />
            Разметьте 5+ событий в Audit Log, чтобы увидеть P/R/F1.
          </span>
          <Link to="/audit-log" className="text-[12px] text-accent hover:underline inline-flex items-center gap-1">
            Перейти к разметке <ExternalLink className="w-3 h-3" />
          </Link>
        </div>
      </div>
    );
  }

  const isLowSample = data.total_labeled < 5;

  return (
    <div className="content-card flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h3 className="text-body-strong flex items-center gap-2">
          <Target className="w-4 h-4" /> Качество L4 на разметке
        </h3>
        <span className="text-[11px] text-text-tertiary font-mono">
          n={data.total_labeled} ({data.by_label.confirmed_attack} attack / {data.by_label.false_positive} FP)
        </span>
      </div>

      {isLowSample && (
        <div className="text-[11px] px-3 py-2 rounded-md bg-[rgba(245,166,35,0.08)] border border-[rgba(245,166,35,0.2)] text-status-warning">
          Мало размеченных событий ({data.total_labeled}). Метрики могут быть шумные — желательно ≥20.
        </div>
      )}

      <div className="grid grid-cols-3 gap-2">
        <Metric label="Precision" value={data.precision} color="#4A9EFF" />
        <Metric label="Recall" value={data.recall} color="#F5A623" />
        <Metric label="F1" value={data.f1} color="#46A758" />
      </div>

      <div className="grid grid-cols-4 gap-1.5 text-[10px]">
        {[
          { label: "TP", value: data.tp, color: "text-status-success" },
          { label: "FP", value: data.fp, color: "text-status-critical" },
          { label: "TN", value: data.tn, color: "text-text-secondary" },
          { label: "FN", value: data.fn, color: "text-status-warning" },
        ].map(({ label, value, color }) => (
          <div key={label} className="bg-surface-2 px-2 py-1.5 rounded border border-border-subtle">
            <div className="text-text-tertiary uppercase tracking-wider">{label}</div>
            <div className={`font-mono font-bold text-[14px] ${color}`}>{value}</div>
          </div>
        ))}
      </div>

      {data.top_false_positives.length > 0 && (
        <div className="flex flex-col gap-1.5 pt-2 border-t border-border-subtle">
          <span className="text-[10px] uppercase tracking-wider text-text-tertiary font-medium">
            Топ-{data.top_false_positives.length} false positives
          </span>
          <div className="flex flex-col gap-1 max-h-32 overflow-y-auto">
            {data.top_false_positives.map(fp => (
              <Link
                key={fp.event_id}
                to={`/audit-log?event_id=${fp.event_id}`}
                className="flex items-center gap-2 px-2 py-1.5 rounded bg-surface-2 hover:bg-surface-3 border border-border-subtle transition-colors group"
              >
                <span className="text-[11px] font-mono text-status-critical bg-[rgba(229,72,77,0.1)] px-1.5 py-0.5 rounded shrink-0">
                  {fp.score.toFixed(2)}
                </span>
                <span className="text-[11px] text-text-secondary truncate flex-1 group-hover:text-text-primary">
                  {fp.request_text}
                </span>
                <ExternalLink className="w-3 h-3 text-text-tertiary opacity-0 group-hover:opacity-100" />
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
