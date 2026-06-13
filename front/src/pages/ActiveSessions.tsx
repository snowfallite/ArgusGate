import { useState, useEffect, useCallback, useMemo } from "react";
import { SectionHeader } from "@/components/SectionHeader";
import { StatusPill } from "@/components/StatusPill";
import {
  Activity, CircleOff, RefreshCw, AlertTriangle,
  Hash, Clock, MessagesSquare, ShieldAlert,
  Radio, AppWindow, TrendingUp, Search, History,
  ChevronDown, ChevronRight, FileText,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { api } from "@/api/client";
import { useSessionsStream, SessionEventPayload } from "@/hooks/useSessionsStream";
import { RiskTimelineChart } from "@/components/RiskTimelineChart";
import { RiskBreakdownBar, RiskBreakdown } from "@/components/RiskBreakdownBar";

// ─── Types ────────────────────────────────────────────────────────────────────

interface EventSummary {
  layer: number;
  verdict: string;
  score: number | null;
  category: string | null;
  reason: string | null;
}

interface SessionRequestEntry {
  request_log_id: string;
  timestamp: string;
  request_text: string;
  response_text: string | null;
  verdict: string | null;
  detection_events: EventSummary[];
}

interface HistoricalSession {
  session_id: string;
  started_at: string;
  last_activity: string;
  request_count: number;
  status: string;
}

interface SessionSummary {
  session_id: string;
  client_app: string | null;
  started_at: string;
  last_activity: string;
  turn_count: number;
  cumulative_risk_score: number;
  status: string;
}

interface TurnRecord {
  turn_number: number;
  topic_label: string | null;
  user_refused: boolean;
  risk_contribution: number;
  request_log_id: string | null;
}

interface RiskPoint { turn: number; score: number; }

interface SessionDetail extends SessionSummary {
  turns: TurnRecord[];
  refusal_count: number;
  self_reference_count: number;
  risk_timeline: RiskPoint[];
  risk_breakdown_last: RiskBreakdown;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const STATUS_RU: Record<string, string> = {
  Quarantine: "Карантин",
  Suspicious: "Подозрительно",
  Active: "Активна",
  Expired: "Истекла",
};

const LAYER_NAMES: Record<number, string> = {
  1: "Норм.", 2: "Сигнат.", 3: "Векторы",
  4: "Классиф.", 5: "Сессия", 6: "Вывод", 7: "Судья",
};

const SELECTED_KEY = "argusgate:activeSessions:selectedId";
const FILTER_KEY = "argusgate:activeSessions:appFilter";

function tStatus(s: string) { return STATUS_RU[s] ?? s; }

function statusKind(s: string): "critical" | "warning" | "success" | "info" {
  if (s === "Quarantine") return "critical";
  if (s === "Suspicious") return "warning";
  if (s === "Expired") return "info";
  return "info";
}

function riskColor(score: number): { bg: string; border: string; text: string } {
  if (score > 0.85) return { bg: "rgba(229,72,77,0.10)", border: "rgba(229,72,77,0.28)", text: "var(--status-critical)" };
  if (score > 0.6) return { bg: "rgba(245,166,35,0.10)", border: "rgba(245,166,35,0.28)", text: "var(--status-warning)" };
  return { bg: "rgba(70,167,88,0.08)", border: "rgba(70,167,88,0.22)", text: "var(--status-success)" };
}

function riskBarColor(score: number) {
  if (score > 0.85) return "bg-status-critical";
  if (score > 0.6) return "bg-status-warning";
  return "bg-status-success";
}

function relativeTime(iso: string): string {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return "только что";
  if (diff < 3600) return `${Math.floor(diff / 60)} мин назад`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} ч назад`;
  return new Date(iso).toLocaleDateString();
}

function verdictEventColor(verdict: string) {
  if (verdict === "block") return "text-status-critical bg-[rgba(229,72,77,0.08)] border-[rgba(229,72,77,0.2)]";
  if (verdict === "suspicious" || verdict === "escalate") return "text-status-warning bg-[rgba(245,166,35,0.06)] border-[rgba(245,166,35,0.18)]";
  return "text-text-tertiary bg-surface-3 border-border-subtle";
}

// ─── Sessions list (chat-like sidebar) ────────────────────────────────────────

function SessionListItem({
  session, selected, pulsing, onClick,
}: {
  session: SessionSummary; selected: boolean; pulsing: boolean; onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full text-left px-3 py-2.5 rounded-lg border transition-all flex flex-col gap-1.5",
        selected
          ? "bg-[rgba(74,158,255,0.1)] border-[rgba(74,158,255,0.35)]"
          : "bg-surface-2 border-border-subtle hover:bg-surface-3 hover:border-border-default",
        pulsing && "animate-pulse"
      )}
      title={session.session_id}
    >
      <div className="flex items-center gap-2 w-full">
        <StatusPill status={statusKind(session.status)} label={tStatus(session.status)} />
        {session.client_app === "__test__" ? (
          <span className="px-1.5 py-0.5 rounded border text-[10px] inline-flex items-center gap-1"
            style={{ background: "rgba(151,88,255,0.08)", border: "1px solid rgba(151,88,255,0.3)", color: "#9758FF" }}>
            🧪 Тест
          </span>
        ) : session.client_app ? (
          <span className="px-1.5 py-0.5 rounded bg-surface-3 border border-border-subtle text-text-secondary text-[10px] inline-flex items-center gap-1">
            <AppWindow className="w-2.5 h-2.5" />
            {session.client_app}
          </span>
        ) : null}
        <span className="ml-auto text-[10px] text-text-tertiary whitespace-nowrap">
          {relativeTime(session.last_activity)}
        </span>
      </div>

      <span className={cn(
        "font-mono text-[11px] break-all leading-snug",
        selected ? "text-accent" : "text-text-primary"
      )}>
        {session.session_id}
      </span>

      <div className="flex items-center gap-2 w-full">
        <span className="text-[10px] text-text-tertiary flex items-center gap-1 shrink-0">
          <MessagesSquare className="w-2.5 h-2.5" />
          {session.turn_count}
        </span>
        <div className="flex-1 h-1 bg-surface-3 rounded-full overflow-hidden">
          <div
            className={cn("h-full rounded-full transition-all", riskBarColor(session.cumulative_risk_score))}
            style={{ width: `${Math.min(session.cumulative_risk_score * 100, 100)}%` }}
          />
        </div>
        <span className="font-mono text-[10px] text-text-tertiary w-8 text-right">
          {session.cumulative_risk_score.toFixed(2)}
        </span>
      </div>
    </button>
  );
}

function HistoricalListItem({
  session, selected, onClick,
}: {
  session: HistoricalSession; selected: boolean; onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full text-left px-3 py-2.5 rounded-lg border transition-all flex flex-col gap-1.5",
        selected
          ? "bg-[rgba(74,158,255,0.1)] border-[rgba(74,158,255,0.35)]"
          : "bg-surface-2 border-border-subtle hover:bg-surface-3 hover:border-border-default opacity-70"
      )}
      title={session.session_id}
    >
      <div className="flex items-center gap-2 w-full">
        <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-surface-3 border border-border-default text-text-tertiary uppercase tracking-wide">
          истекла
        </span>
        <span className="ml-auto text-[10px] text-text-tertiary whitespace-nowrap">
          {relativeTime(session.last_activity)}
        </span>
      </div>
      <span className={cn(
        "font-mono text-[11px] break-all leading-snug",
        selected ? "text-accent" : "text-text-secondary"
      )}>
        {session.session_id}
      </span>
      <span className="text-[10px] text-text-tertiary flex items-center gap-1">
        <FileText className="w-2.5 h-2.5" />
        {session.request_count} {session.request_count === 1 ? "запрос" : "запросов"}
      </span>
    </button>
  );
}

// ─── Session detail panel ─────────────────────────────────────────────────────

function TurnCard({ turn, request }: { turn: TurnRecord; request: SessionRequestEntry | undefined }) {
  const [expanded, setExpanded] = useState(false);
  const hasEvents = (request?.detection_events ?? []).filter(e => e.verdict !== "pass").length > 0;
  const hasText = !!request?.request_text;

  return (
    <div
      className="flex flex-col rounded-lg overflow-hidden"
      style={{
        background: turn.user_refused ? "rgba(245,166,35,0.06)" : "var(--surface-2)",
        border: `1px solid ${turn.user_refused ? "rgba(245,166,35,0.25)" : "var(--border-subtle)"}`,
      }}
    >
      <div className="flex items-start gap-3 px-3 py-2 text-[12px]">
        <span className="font-mono text-[11px] font-bold px-1.5 py-0.5 rounded text-text-secondary bg-surface-3 shrink-0 mt-0.5">
          #{turn.turn_number}
        </span>
        <div className="flex-1 min-w-0 flex flex-col gap-0.5">
          <span className="text-text-primary line-clamp-2">
            {hasText
              ? request!.request_text.slice(0, 120) + (request!.request_text.length > 120 ? "…" : "")
              : turn.topic_label
                ? turn.topic_label
                : <span className="text-text-tertiary italic">тема не определена</span>
            }
          </span>
          {turn.topic_label && hasText && (
            <span className="text-[10px] text-text-tertiary">тема: {turn.topic_label}</span>
          )}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {turn.risk_contribution > 0 && (
            <span className="font-mono text-[11px] text-text-tertiary">+{turn.risk_contribution.toFixed(2)}</span>
          )}
          {turn.user_refused && (
            <span className="text-[10px] font-bold text-status-warning bg-[rgba(245,166,35,0.1)] px-1.5 py-0.5 rounded uppercase">
              отказ
            </span>
          )}
          {request?.verdict && request.verdict !== "pass" && (
            <span className={cn("text-[10px] font-bold px-1.5 py-0.5 rounded uppercase",
              request.verdict === "block" ? "text-status-critical bg-[rgba(229,72,77,0.1)]" : "text-status-warning bg-[rgba(245,166,35,0.08)]")}>
              {request.verdict}
            </span>
          )}
          {(hasEvents || (hasText && request!.request_text.length > 120)) && (
            <button onClick={() => setExpanded(v => !v)}
              className="text-text-tertiary hover:text-text-secondary transition-colors p-0.5 rounded">
              {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
            </button>
          )}
        </div>
      </div>

      {expanded && (
        <div className="border-t border-border-subtle px-3 py-2 flex flex-col gap-2">
          {hasText && request!.request_text.length > 120 && (
            <p className="text-[11px] text-text-secondary whitespace-pre-wrap break-words">
              {request!.request_text.slice(0, 2000)}
              {request!.request_text.length > 2000 && <span className="text-text-tertiary"> …(сокращено)</span>}
            </p>
          )}
          {hasEvents && (
            <div className="flex flex-wrap gap-1">
              {request!.detection_events.filter(e => e.verdict !== "pass").map((ev, i) => (
                <span key={i} className={cn(
                  "inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border",
                  verdictEventColor(ev.verdict)
                )}>
                  <span className="font-bold">{LAYER_NAMES[ev.layer] ?? `L${ev.layer}`}</span>
                  {ev.category && <span>· {ev.category}</span>}
                  {ev.score != null && <span className="font-mono opacity-75">{ev.score.toFixed(2)}</span>}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function SessionDetailPanel({
  session, requests, loadingRequests, onTerminated,
}: {
  session: SessionDetail;
  requests: SessionRequestEntry[];
  loadingRequests: boolean;
  onTerminated: (id: string) => void;
}) {
  const [terminating, setTerminating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const requestsMap = useMemo(() => {
    const m: Record<string, SessionRequestEntry> = {};
    requests.forEach(r => { m[r.request_log_id] = r; });
    return m;
  }, [requests]);

  const terminate = async () => {
    setTerminating(true);
    setError(null);
    try {
      await api.delete(`/sessions/${session.session_id}`);
      onTerminated(session.session_id);
    } catch (e: any) {
      setError(e.message || "Не удалось завершить сессию");
      setTerminating(false);
    }
  };

  const rc = riskColor(session.cumulative_risk_score);
  const isQuarantined = session.status === "Quarantine";

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="px-5 py-4 border-b border-border-subtle bg-surface-2 shrink-0">
        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-col gap-1.5 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <StatusPill status={statusKind(session.status)} label={tStatus(session.status)} />
              {session.client_app === "__test__" ? (
                <span className="px-2 py-0.5 rounded-full text-[11px] font-medium inline-flex items-center gap-1"
                  style={{ background: "rgba(151,88,255,0.08)", border: "1px solid rgba(151,88,255,0.3)", color: "#9758FF" }}>
                  🧪 Тестовая сессия
                </span>
              ) : session.client_app ? (
                <span className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-surface-3 text-text-secondary border border-border-subtle inline-flex items-center gap-1">
                  <AppWindow className="w-3 h-3" />
                  {session.client_app}
                </span>
              ) : null}
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium"
                style={{ background: rc.bg, color: rc.text, border: `1px solid ${rc.border}` }}>
                <ShieldAlert className="w-3 h-3" />
                Риск {session.cumulative_risk_score.toFixed(2)}
              </span>
            </div>
            <div className="flex items-center gap-3 text-[11px] text-text-tertiary">
              <span className="flex items-center gap-1 font-mono truncate">
                <Hash className="w-3 h-3 shrink-0" />
                {session.session_id}
              </span>
              <span className="flex items-center gap-1 whitespace-nowrap">
                <Clock className="w-3 h-3" />
                с {new Date(session.started_at).toLocaleString()}
              </span>
            </div>
          </div>
          {!isQuarantined && (
            <button onClick={terminate} disabled={terminating}
              className="shrink-0 px-3 py-1.5 bg-status-critical text-white rounded-md text-[12px] font-medium hover:opacity-90 disabled:opacity-50 transition-opacity">
              {terminating ? "Завершение…" : "Завершить"}
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-5 flex flex-col gap-5">
        <div className="grid grid-cols-4 gap-2.5">
          {[
            { icon: <ShieldAlert className="w-3.5 h-3.5" />, label: "Риск", value: session.cumulative_risk_score.toFixed(2), color: rc.text },
            { icon: <MessagesSquare className="w-3.5 h-3.5" />, label: "Ходов", value: session.turn_count.toString() },
            { icon: <CircleOff className="w-3.5 h-3.5" />, label: "Отказов", value: session.refusal_count.toString() },
            { icon: <Activity className="w-3.5 h-3.5" />, label: "Самоссыл.", value: session.self_reference_count.toString() },
          ].map(({ icon, label, value, color }) => (
            <div key={label} className="flex flex-col gap-1 rounded-xl px-3 py-2.5 bg-surface-2 border border-border-subtle">
              <div className="flex items-center gap-1.5 text-text-tertiary">
                {icon}
                <span className="text-[10px] uppercase tracking-wider font-medium">{label}</span>
              </div>
              <span className="text-[18px] font-mono font-bold" style={{ color: color ?? "var(--text-primary)" }}>{value}</span>
            </div>
          ))}
        </div>

        <div className="flex flex-col gap-2 p-4 rounded-xl"
          style={{ background: rc.bg, border: `1px solid ${rc.border}` }}>
          <div className="flex items-center justify-between">
            <span className="text-[12px] font-medium text-text-secondary uppercase tracking-wider">
              Кумулятивный риск
            </span>
            <span className="font-mono font-bold text-[14px]" style={{ color: rc.text }}>
              {(session.cumulative_risk_score * 100).toFixed(1)}%
            </span>
          </div>
          <div className="h-2 bg-surface-3 rounded-full overflow-hidden">
            <div className={cn("h-full rounded-full transition-all duration-500", riskBarColor(session.cumulative_risk_score))}
              style={{ width: `${Math.min(session.cumulative_risk_score * 100, 100)}%` }}
            />
          </div>
          <div className="flex items-center justify-between text-[10px] text-text-tertiary">
            <span>0.00</span>
            <span>эскалация 0.60</span>
            <span>карантин 0.85</span>
            <span>1.00</span>
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <h3 className="text-body-strong text-[13px] flex items-center gap-2">
            <TrendingUp className="w-3.5 h-3.5 text-text-tertiary" />
            Тренд риска по ходам
          </h3>
          <div className="p-3 rounded-xl bg-surface-2 border border-border-subtle">
            <RiskTimelineChart data={session.risk_timeline} />
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <h3 className="text-body-strong text-[13px] flex items-center gap-2">
            <ShieldAlert className="w-3.5 h-3.5 text-text-tertiary" />
            Вклад детекторов (последний ход)
          </h3>
          <div className="p-4 rounded-xl bg-surface-2 border border-border-subtle">
            <RiskBreakdownBar breakdown={session.risk_breakdown_last} />
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <h3 className="text-body-strong text-[13px] flex items-center gap-2">
            <MessagesSquare className="w-3.5 h-3.5 text-text-tertiary" />
            История ходов ({session.turn_count})
            {loadingRequests && (
              <span className="ml-auto text-[10px] text-text-tertiary flex items-center gap-1">
                <RefreshCw className="w-3 h-3 animate-spin" /> загрузка запросов…
              </span>
            )}
          </h3>
          {session.turns.length === 0 ? (
            <div className="px-4 py-3 rounded-xl text-[12px] text-text-tertiary bg-surface-2 border border-border-subtle">
              Ходов пока нет
            </div>
          ) : (
            <div className="flex flex-col gap-1.5">
              {session.turns.map(t => (
                <TurnCard
                  key={t.turn_number}
                  turn={t}
                  request={t.request_log_id ? requestsMap[t.request_log_id] : undefined}
                />
              ))}
            </div>
          )}
        </div>

        {error && (
          <div className="text-[12px] px-3 py-2 rounded-lg text-status-critical bg-[rgba(229,72,77,0.08)]">
            {error}
          </div>
        )}

        {isQuarantined && (
          <div className="flex items-start gap-2.5 px-4 py-3 rounded-xl text-[12px] text-text-secondary"
            style={{ background: "rgba(229,72,77,0.06)", border: "1px solid rgba(229,72,77,0.22)" }}>
            <AlertTriangle className="w-4 h-4 text-status-critical shrink-0 mt-0.5" />
            <div className="flex flex-col gap-0.5">
              <span className="font-medium text-text-primary">Сессия в карантине</span>
              <span>Cumulative risk превысил 0.85. Все последующие ходы помечаются escalate — L7-судья принимает финальное решение по каждому.</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Historical detail panel (expired from Redis, data from PostgreSQL) ────────

function HistoricalDetailPanel({
  hist, requests, loading,
}: {
  hist: HistoricalSession;
  requests: SessionRequestEntry[];
  loading: boolean;
}) {
  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="px-5 py-4 border-b border-border-subtle bg-surface-2 shrink-0">
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-surface-3 border border-border-default text-text-secondary uppercase tracking-wide">
              Истёкшая сессия
            </span>
            <span className="text-[11px] text-text-tertiary flex items-center gap-1">
              <FileText className="w-3 h-3" />
              {hist.request_count} запросов
            </span>
          </div>
          <div className="flex items-center gap-3 text-[11px] text-text-tertiary">
            <span className="flex items-center gap-1 font-mono truncate">
              <Hash className="w-3 h-3 shrink-0" />
              {hist.session_id}
            </span>
            <span className="flex items-center gap-1 whitespace-nowrap">
              <Clock className="w-3 h-3" />
              {new Date(hist.started_at).toLocaleString()} — {new Date(hist.last_activity).toLocaleString()}
            </span>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-5">
        {loading ? (
          <div className="flex justify-center py-8">
            <div className="w-5 h-5 border-2 border-accent border-t-transparent rounded-full animate-spin" />
          </div>
        ) : requests.length === 0 ? (
          <div className="px-4 py-3 rounded-xl text-[12px] text-text-tertiary bg-surface-2 border border-border-subtle">
            Запросы не найдены
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {requests.map((req, i) => (
              <div key={req.request_log_id}
                className="flex flex-col gap-1.5 rounded-lg bg-surface-2 border border-border-subtle overflow-hidden">
                <div className="flex items-start gap-2.5 px-3 py-2">
                  <span className="font-mono text-[11px] font-bold px-1.5 py-0.5 rounded text-text-secondary bg-surface-3 shrink-0 mt-0.5">
                    #{i + 1}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-[12px] text-text-primary break-words">
                      {req.request_text.slice(0, 200)}
                      {req.request_text.length > 200 && <span className="text-text-tertiary">…</span>}
                    </p>
                    <span className="text-[10px] text-text-tertiary">
                      {new Date(req.timestamp).toLocaleString()}
                    </span>
                  </div>
                  {req.verdict && req.verdict !== "pass" && (
                    <span className={cn(
                      "shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded uppercase",
                      req.verdict === "block" ? "text-status-critical bg-[rgba(229,72,77,0.1)]" : "text-status-warning bg-[rgba(245,166,35,0.08)]"
                    )}>
                      {req.verdict}
                    </span>
                  )}
                </div>
                {req.detection_events.filter(e => e.verdict !== "pass").length > 0 && (
                  <div className="flex flex-wrap gap-1 px-3 pb-2 border-t border-border-subtle pt-1.5">
                    {req.detection_events.filter(e => e.verdict !== "pass").map((ev, j) => (
                      <span key={j} className={cn(
                        "inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border",
                        verdictEventColor(ev.verdict)
                      )}>
                        <span className="font-bold">{LAYER_NAMES[ev.layer] ?? `L${ev.layer}`}</span>
                        {ev.category && <span>· {ev.category}</span>}
                        {ev.score != null && <span className="font-mono opacity-75">{ev.score.toFixed(2)}</span>}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export function ActiveSessions() {
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [apps, setApps] = useState<string[]>([]);
  const [appFilter, setAppFilter] = useState<string>(() => {
    try { return localStorage.getItem(FILTER_KEY) ?? ""; } catch { return ""; }
  });
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(() => {
    try { return localStorage.getItem(SELECTED_KEY); } catch { return null; }
  });
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [requests, setRequests] = useState<SessionRequestEntry[]>([]);
  const [loadingRequests, setLoadingRequests] = useState(false);
  const [pulseIds, setPulseIds] = useState<Set<string>>(new Set());

  const [historyMode, setHistoryMode] = useState(false);
  const [historySessions, setHistorySessions] = useState<HistoricalSession[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [histSelectedId, setHistSelectedId] = useState<string | null>(null);
  const [histRequests, setHistRequests] = useState<SessionRequestEntry[]>([]);
  const [loadingHistRequests, setLoadingHistRequests] = useState(false);
  const [histDetail, setHistDetail] = useState<HistoricalSession | null>(null);

  useEffect(() => {
    try {
      if (selectedId) localStorage.setItem(SELECTED_KEY, selectedId);
      else localStorage.removeItem(SELECTED_KEY);
    } catch {}
  }, [selectedId]);

  useEffect(() => {
    try {
      if (appFilter) localStorage.setItem(FILTER_KEY, appFilter);
      else localStorage.removeItem(FILTER_KEY);
    } catch {}
  }, [appFilter]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = appFilter ? `?client_app=${encodeURIComponent(appFilter)}` : "";
      const [list, appsResp] = await Promise.all([
        api.get<SessionSummary[]>(`/sessions${params}`),
        api.get<{ apps: string[] }>("/sessions/apps"),
      ]);
      setSessions(list);
      setApps(appsResp.apps);
    } catch {}
    setLoading(false);
  }, [appFilter]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      setRequests([]);
      return;
    }
    let cancelled = false;
    setLoadingDetail(true);
    setLoadingRequests(true);

    Promise.allSettled([
      api.get<SessionDetail>(`/sessions/${selectedId}`),
      api.get<SessionRequestEntry[]>(`/sessions/${selectedId}/requests`),
    ]).then(([detailResult, requestsResult]) => {
      if (cancelled) return;
      if (detailResult.status === "fulfilled") {
        setDetail(detailResult.value);
      } else {
        setDetail(null);
        setSelectedId(null);
      }
      setRequests(requestsResult.status === "fulfilled" ? requestsResult.value : []);
    }).finally(() => {
      if (!cancelled) {
        setLoadingDetail(false);
        setLoadingRequests(false);
      }
    });

    return () => { cancelled = true; };
  }, [selectedId]);

  const loadHistory = useCallback(async () => {
    setLoadingHistory(true);
    try {
      const hist = await api.get<HistoricalSession[]>("/sessions/history");
      setHistorySessions(hist);
    } catch {}
    setLoadingHistory(false);
  }, []);

  useEffect(() => {
    if (historyMode && historySessions.length === 0) {
      loadHistory();
    }
  }, [historyMode, historySessions.length, loadHistory]);

  const selectHistSession = useCallback((sess: HistoricalSession) => {
    setHistSelectedId(sess.session_id);
    setHistDetail(sess);
    setHistRequests([]);
    setLoadingHistRequests(true);
    api.get<SessionRequestEntry[]>(`/sessions/${sess.session_id}/requests`)
      .then(setHistRequests)
      .catch(() => {})
      .finally(() => setLoadingHistRequests(false));
  }, []);

  const handleEvent = useCallback((ev: SessionEventPayload) => {
    if (ev.type === "session_deleted") {
      setSessions(prev => prev.filter(s => s.session_id !== ev.session_id));
      if (selectedId === ev.session_id) {
        setSelectedId(null);
        setDetail(null);
        setRequests([]);
      }
      return;
    }
    if (appFilter && ev.client_app !== appFilter) return;

    setSessions(prev => {
      const idx = prev.findIndex(s => s.session_id === ev.session_id);
      const updated: SessionSummary = {
        session_id: ev.session_id,
        client_app: ev.client_app ?? null,
        started_at: idx >= 0 ? prev[idx].started_at : ev.timestamp,
        last_activity: ev.timestamp,
        turn_count: ev.turn_count,
        cumulative_risk_score: ev.cumulative_risk_score,
        status: ev.status,
      };
      if (idx >= 0) {
        const copy = [...prev];
        copy[idx] = updated;
        return copy.sort((a, b) => b.cumulative_risk_score - a.cumulative_risk_score);
      }
      return [updated, ...prev];
    });

    if (ev.session_id === selectedId && ev.type === "turn_added") {
      Promise.all([
        api.get<SessionDetail>(`/sessions/${ev.session_id}`),
        api.get<SessionRequestEntry[]>(`/sessions/${ev.session_id}/requests`),
      ]).then(([d, reqs]) => {
        setDetail(d);
        setRequests(reqs);
      }).catch(() => {});
    }

    if (ev.type === "session_created") {
      setPulseIds(prev => new Set(prev).add(ev.session_id));
      setTimeout(() => {
        setPulseIds(prev => { const n = new Set(prev); n.delete(ev.session_id); return n; });
      }, 2000);
    }

    if (ev.client_app) {
      setApps(prev => prev.includes(ev.client_app!) ? prev : [...prev, ev.client_app!].sort());
    }
  }, [appFilter, selectedId]);

  useSessionsStream(handleEvent);

  const handleTerminated = (id: string) => {
    setSessions(prev => prev.filter(s => s.session_id !== id));
    setSelectedId(null);
    setDetail(null);
    setRequests([]);
  };

  const visibleSessions = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return sessions;
    return sessions.filter(s =>
      s.session_id.toLowerCase().includes(q) ||
      (s.client_app ?? "").toLowerCase().includes(q)
    );
  }, [sessions, search]);

  const visibleHistory = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return historySessions;
    return historySessions.filter(s => s.session_id.toLowerCase().includes(q));
  }, [historySessions, search]);

  return (
    <div className="flex flex-col h-full gap-4 pb-6">
      <SectionHeader title="Активные сессии" subtitle="Мониторинг активных сессий">
        <div className="flex items-center gap-2">
          
          <button onClick={() => { setHistoryMode(v => !v); setHistSelectedId(null); setHistDetail(null); setHistRequests([]); }}
            className={cn(
              "flex items-center gap-2 px-3 py-1.5 rounded-md transition-colors border text-[13px] font-medium",
              historyMode
                ? "bg-accent text-white border-accent"
                : "bg-surface-2 hover:bg-surface-3 border-border-default text-text-primary"
            )}>
            <History className="w-4 h-4" />
            История
          </button>
          {!historyMode && (
            <button onClick={load} disabled={loading}
              className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-surface-2 hover:bg-surface-3 transition-colors border border-border-default text-text-primary disabled:opacity-50">
              <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
              <span className="text-[13px] font-medium">Обновить</span>
            </button>
          )}
        </div>
      </SectionHeader>

      <div className="grid grid-cols-[420px_1fr] gap-4 flex-1 min-h-0">

        {/* ─── Sidebar ──────────────────────────────────────────────────── */}
        <div className="flex flex-col gap-3 min-h-0 bg-surface-1 border border-border-subtle rounded-xl p-3">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-tertiary" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Поиск по ID или приложению…"
              className="w-full bg-surface-2 border border-border-default rounded-md pl-8 pr-3 py-1.5 text-[12px] text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-accent"
            />
          </div>

          {!historyMode && (
            <div className="flex items-center gap-1.5 flex-wrap">
              <button
                onClick={() => setAppFilter("")}
                className={cn(
                  "px-2 py-0.5 rounded text-[11px] transition-colors border",
                  appFilter === "" ? "bg-accent text-white border-accent" : "bg-surface-2 text-text-secondary border-border-default hover:bg-surface-3"
                )}
              >Все</button>
              {apps.map(a => (
                <button key={a} onClick={() => setAppFilter(a)}
                  className={cn(
                    "px-2 py-0.5 rounded text-[11px] transition-colors border inline-flex items-center gap-1",
                    appFilter === a ? "bg-accent text-white border-accent" : "bg-surface-2 text-text-secondary border-border-default hover:bg-surface-3"
                  )}>
                  <AppWindow className="w-2.5 h-2.5" />
                  {a}
                </button>
              ))}
            </div>
          )}

          <div className="flex items-center justify-between text-[11px] text-text-tertiary px-1">
            {historyMode ? (
              <>
                <span>Истёкших: {visibleHistory.length}</span>
                <button onClick={loadHistory} disabled={loadingHistory}
                  className="flex items-center gap-1 hover:text-text-secondary transition-colors disabled:opacity-50">
                  <RefreshCw className={cn("w-3 h-3", loadingHistory && "animate-spin")} />
                  Обновить
                </button>
              </>
            ) : (
              <>
                <span>Сессий: {visibleSessions.length}</span>
                {appFilter && <span>фильтр: {appFilter}</span>}
              </>
            )}
          </div>

          <div className="flex-1 overflow-y-auto flex flex-col gap-1.5 pr-1">
            {historyMode ? (
              loadingHistory ? (
                Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="h-14 bg-surface-2 rounded-lg animate-pulse" />
                ))
              ) : visibleHistory.length === 0 ? (
                <div className="flex flex-col items-center gap-2 py-8 text-text-tertiary text-center">
                  <History className="w-8 h-8 opacity-30" />
                  <span className="text-[12px] px-4">Истёкших сессий нет</span>
                </div>
              ) : (
                visibleHistory.map(s => (
                  <HistoricalListItem
                    key={s.session_id}
                    session={s}
                    selected={histSelectedId === s.session_id}
                    onClick={() => selectHistSession(s)}
                  />
                ))
              )
            ) : (
              loading ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="h-16 bg-surface-2 rounded-lg animate-pulse" />
                ))
              ) : visibleSessions.length === 0 ? (
                <div className="flex flex-col items-center gap-2 py-8 text-text-tertiary text-center">
                  <Activity className="w-8 h-8 opacity-30" />
                  <span className="text-[12px] px-4">Сессий нет</span>
                </div>
              ) : (
                visibleSessions.map(s => (
                  <SessionListItem
                    key={s.session_id}
                    session={s}
                    selected={selectedId === s.session_id}
                    pulsing={pulseIds.has(s.session_id)}
                    onClick={() => { setSelectedId(s.session_id); }}
                  />
                ))
              )
            )}
          </div>
        </div>

        {/* ─── Main detail panel ────────────────────────────────────────── */}
        <div className="bg-surface-1 border border-border-subtle rounded-xl overflow-hidden min-h-0">
          {historyMode ? (
            histDetail ? (
              <HistoricalDetailPanel
                hist={histDetail}
                requests={histRequests}
                loading={loadingHistRequests}
              />
            ) : (
              <div className="h-full flex flex-col items-center justify-center gap-3 text-text-tertiary p-8 text-center">
                <History className="w-12 h-12 opacity-20" />
                <span className="text-[14px]">Выберите истёкшую сессию слева для просмотра истории запросов</span>
              </div>
            )
          ) : (
            !selectedId ? (
              <div className="h-full flex flex-col items-center justify-center gap-3 text-text-tertiary p-8 text-center">
                <MessagesSquare className="w-12 h-12 opacity-20" />
                <span className="text-[14px]">Выберите сессию слева, чтобы увидеть детали</span>
              </div>
            ) : loadingDetail && !detail ? (
              <div className="h-full flex items-center justify-center">
                <div className="w-6 h-6 border-2 border-accent border-t-transparent rounded-full animate-spin" />
              </div>
            ) : detail ? (
              <SessionDetailPanel
                session={detail}
                requests={requests}
                loadingRequests={loadingRequests}
                onTerminated={handleTerminated}
              />
            ) : (
              <div className="h-full flex flex-col items-center justify-center gap-3 text-text-tertiary p-8 text-center">
                <AlertTriangle className="w-10 h-10 opacity-30" />
                <span className="text-[13px]">Сессия не найдена или время жизни истекло</span>
                <button onClick={() => setSelectedId(null)} className="text-[12px] text-accent underline underline-offset-2">
                  Сбросить выбор
                </button>
              </div>
            )
          )}
        </div>

      </div>
    </div>
  );
}
