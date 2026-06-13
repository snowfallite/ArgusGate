import { useState, useEffect, useRef, useCallback } from "react";
import { LayerPageHeader, LayerDisabledBanner } from "@/components/LayerPageHeader";
import { useLayerStatus } from "@/hooks/useLayerStatus";
import { PeriodPicker } from "@/components/PeriodPicker";
import { useStatsPeriod, formatTimeTick } from "@/hooks/useStatsPeriod";
import { Tabs } from "@/components/Tabs";
import { Slider } from "@/components/Slider";
import { api, layerTestPath } from "@/api/client";
import type { LayerStatsResponse } from "@/api/types";
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip, ResponsiveContainer, Cell,
} from "recharts";
import { RefreshCw, ArrowRight, TrendingUp, Users, AlertTriangle, Shield, Activity, Plus, Trash2, MessagesSquare } from "lucide-react";
import { cn } from "@/lib/utils";

// ─── config type ──────────────────────────────────────────────────────────────

interface Layer5Config {
  enabled?: boolean;
  risk_threshold: number;
  escalate_threshold?: number;
  quarantine_threshold?: number;
  decay_rate?: number;
  session_ttl: number;
  crescendo_threshold: number;
  crescendo_contribution: number;
  post_refusal_contribution: number;
  self_reference_contribution: number;
}

const DEFAULT_CONFIG: Layer5Config = {
  risk_threshold: 0.6,
  escalate_threshold: 0.6,
  quarantine_threshold: 0.85,
  decay_rate: 0.85,
  session_ttl: 1800,
  crescendo_threshold: 0.5,
  crescendo_contribution: 0.7,
  post_refusal_contribution: 0.4,
  self_reference_contribution: 0.30,
};

// ─── audit / session types ────────────────────────────────────────────────────

interface AuditEvent {
  id: string;
  timestamp: string;
  request_text: string;
  verdict: string;
  category: string | null;
  reason: string | null;
  score: number | null;
  latency_ms: number | null;
}

// ─── session simulator (real API) ────────────────────────────────────────────

interface TurnResult {
  id: string;
  text: string;
  verdict: string;
  score: number;
  reason: string;
  category: string | null;
  latency_ms: number;
}

function verdictColor(v: string) {
  if (v === "block") return "text-status-critical";
  if (v === "suspicious" || v === "escalate") return "text-status-warning";
  return "text-status-success";
}

function verdictBg(v: string) {
  if (v === "block") return "bg-[rgba(229,72,77,0.1)] border-[rgba(229,72,77,0.2)]";
  if (v === "suspicious" || v === "escalate") return "bg-[rgba(245,166,35,0.08)] border-[rgba(245,166,35,0.2)]";
  return "bg-[rgba(70,167,88,0.08)] border-[rgba(70,167,88,0.2)]";
}

// ─── localStorage store for simulator sessions ────────────────────────────────
//
// Структура:
//   argusgate:l5sim:sessions   = SimSession[]
//   argusgate:l5sim:turns:{id} = TurnResult[]
//   argusgate:l5sim:selectedId = string | null
//
// При загрузке страницы все сессии ping-уются через GET /api/sessions/{id};
// если backend вернул 404 — Redis-state истёк, удаляем без вопросов.

interface SimSession {
  id: string;
  name: string;
  created_at: string;
  turn_count: number;
  last_turn_at: string | null;
}

const STORE_SESSIONS = "argusgate:l5sim:sessions";
const STORE_TURNS = (id: string) => `argusgate:l5sim:turns:${id}`;
const STORE_SELECTED = "argusgate:l5sim:selectedId";

function loadSessions(): SimSession[] {
  try {
    const raw = localStorage.getItem(STORE_SESSIONS);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function saveSessions(list: SimSession[]): void {
  try { localStorage.setItem(STORE_SESSIONS, JSON.stringify(list)); } catch {}
}

function loadTurns(id: string): TurnResult[] {
  try {
    const raw = localStorage.getItem(STORE_TURNS(id));
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function saveTurns(id: string, turns: TurnResult[]): void {
  try { localStorage.setItem(STORE_TURNS(id), JSON.stringify(turns)); } catch {}
}

function dropSession(id: string): void {
  try { localStorage.removeItem(STORE_TURNS(id)); } catch {}
}

function autoName(firstTurnText: string | undefined, createdAt: string): string {
  if (firstTurnText) {
    const trimmed = firstTurnText.replace(/\s+/g, " ").trim();
    return trimmed.length > 32 ? trimmed.slice(0, 32) + "…" : trimmed;
  }
  return `Сессия ${new Date(createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
}

// ─── Session list item (sidebar) ──────────────────────────────────────────────

function SimSessionItem({
  session, selected, onSelect, onDelete,
}: {
  session: SimSession; selected: boolean; onSelect: () => void; onDelete: () => void;
}) {
  return (
    <div
      className={cn(
        "group rounded-lg border transition-all flex flex-col cursor-pointer",
        selected
          ? "bg-[rgba(74,158,255,0.1)] border-[rgba(74,158,255,0.35)]"
          : "bg-surface-2 border-border-subtle hover:bg-surface-3 hover:border-border-default"
      )}
      onClick={onSelect}
      title={session.id}
    >
      <div className="flex flex-col gap-1 px-3 py-2.5">
        {/* Имя + кнопка удалить */}
        <div className="flex items-start gap-2">
          <MessagesSquare className={cn("w-3.5 h-3.5 mt-0.5 shrink-0", selected ? "text-accent" : "text-text-tertiary")} />
          <span className={cn(
            "text-[12px] font-medium flex-1 break-words leading-snug",
            selected ? "text-text-primary" : "text-text-secondary"
          )}>
            {session.name}
          </span>
          <button
            onClick={e => { e.stopPropagation(); onDelete(); }}
            className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded text-text-tertiary hover:text-status-critical hover:bg-surface-3 shrink-0"
            title="Удалить сессию"
          >
            <Trash2 className="w-3 h-3" />
          </button>
        </div>

        {/* Полный UUID отдельной строкой */}
        <span className={cn(
          "font-mono text-[10px] break-all leading-snug pl-5",
          selected ? "text-accent" : "text-text-tertiary"
        )}>
          {session.id}
        </span>

        {/* Счётчик ходов */}
        <span className="text-[10px] text-text-tertiary pl-5">
          {session.turn_count} {session.turn_count === 1 ? "ход" : "ходов"}
        </span>
      </div>
    </div>
  );
}

// ─── Main simulator (chat-list layout) ────────────────────────────────────────

function SessionSimulator() {
  const [sessions, setSessions] = useState<SimSession[]>(() => loadSessions());
  const [selectedId, setSelectedId] = useState<string | null>(() => {
    try { return localStorage.getItem(STORE_SELECTED); } catch { return null; }
  });
  const [turns, setTurns] = useState<TurnResult[]>([]);
  const [cumulativeRisk, setCumulativeRisk] = useState<number>(0);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [purging, setPurging] = useState(true);
  const turnsScrollRef = useRef<HTMLDivElement>(null);

  // ─── Persist sessions / selected to localStorage ──────────────────────
  useEffect(() => { saveSessions(sessions); }, [sessions]);
  useEffect(() => {
    try {
      if (selectedId) localStorage.setItem(STORE_SELECTED, selectedId);
      else localStorage.removeItem(STORE_SELECTED);
    } catch {}
  }, [selectedId]);

  // ─── On mount: ping each session; drop expired ────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const list = loadSessions();
      if (list.length === 0) {
        setPurging(false);
        return;
      }
      const survivors = await Promise.all(
        list.map(async (s) => {
          try {
            await api.get(`/sessions/${s.id}`);
            return s;
          } catch {
            // Redis истёк или ручка вернула 404 — удаляем
            dropSession(s.id);
            return null;
          }
        })
      );
      if (cancelled) return;
      const alive = survivors.filter((s): s is SimSession => s !== null);
      setSessions(alive);

      // Подтянуть актуальный turn_count из localStorage (могло обновиться)
      setSessions(prev => prev.map(s => {
        const localTurns = loadTurns(s.id);
        return { ...s, turn_count: localTurns.length };
      }));

      // Восстановить выбор
      const stored = (() => { try { return localStorage.getItem(STORE_SELECTED); } catch { return null; } })();
      if (stored && alive.find(s => s.id === stored)) {
        setSelectedId(stored);
        setTurns(loadTurns(stored));
      } else if (alive.length > 0) {
        setSelectedId(alive[0].id);
        setTurns(loadTurns(alive[0].id));
      } else {
        setSelectedId(null);
        setTurns([]);
      }
      setPurging(false);
    })();
    return () => { cancelled = true; };
  }, []);

  // ─── Auto-scroll к низу при добавлении хода ───────────────────────────
  useEffect(() => {
    if (turnsScrollRef.current) {
      turnsScrollRef.current.scrollTop = turnsScrollRef.current.scrollHeight;
    }
  }, [turns.length, sending]);

  // ─── Actions ──────────────────────────────────────────────────────────
  const createSession = useCallback(() => {
    const id = crypto.randomUUID();
    const created = new Date().toISOString();
    const session: SimSession = {
      id, name: `Сессия ${new Date(created).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`,
      created_at: created, turn_count: 0, last_turn_at: null,
    };
    setSessions(prev => [session, ...prev]);
    setSelectedId(id);
    setTurns([]);
    setCumulativeRisk(0);
    saveTurns(id, []);
    setError("");
    setInput("");
  }, []);

  const selectSession = useCallback((id: string) => {
    setSelectedId(id);
    setTurns(loadTurns(id));
    setCumulativeRisk(0);
    setError("");
    setInput("");
    api.get<{ cumulative_risk_score: number }>(`/sessions/${id}`)
      .then(d => setCumulativeRisk(d.cumulative_risk_score))
      .catch(() => {});
  }, []);

  const deleteSession = useCallback(async (id: string) => {
    // Удаляем в Redis (best-effort), потом локально
    try { await api.delete(`/sessions/${id}`); } catch {}
    dropSession(id);
    setSessions(prev => {
      const next = prev.filter(s => s.id !== id);
      if (selectedId === id) {
        if (next.length > 0) {
          setSelectedId(next[0].id);
          setTurns(loadTurns(next[0].id));
          setCumulativeRisk(0);
          api.get<{ cumulative_risk_score: number }>(`/sessions/${next[0].id}`)
            .then(d => setCumulativeRisk(d.cumulative_risk_score))
            .catch(() => {});
        } else {
          setSelectedId(null);
          setTurns([]);
          setCumulativeRisk(0);
        }
      }
      return next;
    });
  }, [selectedId]);

  const sendTurn = useCallback(async () => {
    if (!input.trim() || sending) return;
    let sid = selectedId;
    // Если нет активной сессии — создаём
    if (!sid) {
      sid = crypto.randomUUID();
      const created = new Date().toISOString();
      const newSession: SimSession = {
        id: sid, name: `Сессия ${new Date(created).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`,
        created_at: created, turn_count: 0, last_turn_at: null,
      };
      setSessions(prev => [newSession, ...prev]);
      setSelectedId(sid);
      saveTurns(sid, []);
    }

    const text = input.trim();
    setInput("");
    setSending(true);
    setError("");
    try {
      const res = await api.post<{ verdict: string; score: number; reason: string; category: string | null; latency_ms: number }>(
        layerTestPath(5),
        { text, session_id: sid }
      );
      const turn: TurnResult = {
        id: crypto.randomUUID(),
        text, verdict: res.verdict, score: res.score, reason: res.reason,
        category: res.category, latency_ms: res.latency_ms,
      };
      const nextTurns = [...turns, turn];
      setTurns(nextTurns);
      saveTurns(sid, nextTurns);
      setSessions(prev => prev.map(s => s.id === sid ? {
        ...s,
        name: s.turn_count === 0 ? autoName(text, s.created_at) : s.name,
        turn_count: nextTurns.length,
        last_turn_at: new Date().toISOString(),
      } : s));
      // Обновляем кумулятивный риск из Redis-состояния сессии
      api.get<{ cumulative_risk_score: number }>(`/sessions/${sid}`)
        .then(d => setCumulativeRisk(d.cumulative_risk_score))
        .catch(() => {});
    } catch (e: any) {
      setError(e.message || "Request failed");
    }
    setSending(false);
  }, [input, sending, selectedId, turns]);

  const latestScore = turns.length > 0 ? turns[turns.length - 1].score : 0;
  const selected = sessions.find(s => s.id === selectedId);
  const cumulativeRiskColor = cumulativeRisk > 0.85 ? "var(--status-critical)" : cumulativeRisk > 0.6 ? "var(--status-warning)" : "var(--status-success)";

  return (
    <div className="grid grid-cols-[360px_1fr] gap-4 h-[640px]">
      {/* Sidebar — список сессий */}
      <div className="flex flex-col gap-3 bg-surface-1 border border-border-subtle rounded-xl p-3 min-h-0">
        <button
          onClick={createSession}
          className="flex items-center justify-center gap-2 px-3 py-2 bg-accent text-white rounded-md text-[12px] font-medium hover:opacity-90 transition-opacity"
        >
          <Plus className="w-3.5 h-3.5" /> Новая сессия
        </button>

        <div className="flex items-center justify-between text-[10px] text-text-tertiary px-1">
          <span>Сессий: {sessions.length}</span>
          {purging && <span className="italic">синхронизация…</span>}
        </div>

        <div className="flex-1 overflow-y-auto flex flex-col gap-1.5 pr-1 min-h-0">
          {purging && sessions.length === 0 ? (
            <div className="text-[11px] text-text-tertiary text-center py-4">Проверка состояния…</div>
          ) : sessions.length === 0 ? (
            <div className="text-[11px] text-text-tertiary text-center py-4 px-2">
              Нет сохранённых сессий. Создайте новую или просто отправьте сообщение.
            </div>
          ) : (
            sessions.map(s => (
              <SimSessionItem
                key={s.id}
                session={s}
                selected={selectedId === s.id}
                onSelect={() => selectSession(s.id)}
                onDelete={() => deleteSession(s.id)}
              />
            ))
          )}
        </div>

        <p className="text-[10px] text-text-tertiary px-1 pt-2 border-t border-border-subtle">
          Истёкшие сессии (TTL Redis) удаляются автоматически при открытии страницы.
        </p>
      </div>

      {/* Main — чат и инпут */}
      <div className="flex flex-col gap-3 min-h-0">
        {/* Header текущей сессии */}
        <div className="flex items-center justify-between gap-3 px-4 py-2 bg-surface-2 border border-border-subtle rounded-xl">
          <div className="flex flex-col min-w-0 gap-0.5">
            <span className="text-[13px] font-medium text-text-primary truncate">
              {selected ? selected.name : "Сессия не выбрана"}
            </span>
            {selected && (
              <span className="text-[11px] font-mono text-text-tertiary select-all" title="Кликни чтобы выделить">
                {selected.id}
              </span>
            )}
          </div>
          {turns.length > 0 && (
            <div className="flex items-center gap-4 shrink-0">
              <div className="flex items-center gap-1.5">
                <span className="text-[11px] text-text-tertiary">Скор хода:</span>
                <div className="w-20 h-1.5 bg-surface-3 rounded-full overflow-hidden">
                  <div className="h-full rounded-full transition-all duration-500"
                    style={{ width: `${latestScore * 100}%`, backgroundColor: latestScore > 0.7 ? "var(--status-critical)" : latestScore > 0.4 ? "var(--status-warning)" : "var(--status-success)" }}
                  />
                </div>
                <span className="font-mono text-[11px] text-text-primary w-7">{latestScore.toFixed(2)}</span>
              </div>
              <div className="flex items-center gap-1.5 border-l border-border-subtle pl-4">
                <span className="text-[11px] text-text-tertiary">Риск сессии:</span>
                <div className="w-20 h-1.5 bg-surface-3 rounded-full overflow-hidden">
                  <div className="h-full rounded-full transition-all duration-500"
                    style={{ width: `${Math.min(cumulativeRisk * 100, 100)}%`, backgroundColor: cumulativeRiskColor }}
                  />
                </div>
                <span className="font-mono text-[11px] font-bold w-7" style={{ color: cumulativeRiskColor }}>{cumulativeRisk.toFixed(2)}</span>
              </div>
            </div>
          )}
        </div>

        {/* Поток ходов */}
        <div ref={turnsScrollRef} className="flex-1 overflow-y-auto border border-border-subtle rounded-xl p-4 bg-surface-2 flex flex-col gap-2 min-h-0">
          {turns.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-text-tertiary text-[13px] gap-2 text-center px-8">
              <MessagesSquare className="w-8 h-8 opacity-30" />
              <span>
                {selected
                  ? "Отправляйте сообщения для тестирования многоходового обнаружения"
                  : "Создайте сессию или начните печатать — она создастся автоматически"}
              </span>
              <span className="text-[11px] opacity-70">
                Попробуйте Crescendo: «Расскажи о химии» → «Что реагирует в быту?» → «Чем это опасно?» → ...
              </span>
            </div>
          ) : (
            turns.map((turn, i) => (
              <div key={turn.id} className="flex flex-col gap-1">
                <div className="flex items-start gap-2">
                  <span className="text-[11px] text-text-tertiary mt-1.5 w-5 text-right shrink-0 font-mono">#{i + 1}</span>
                  <div className="flex-1 bg-surface-1 border border-border-subtle rounded-lg px-3 py-2">
                    <p className="text-[13px] text-text-primary whitespace-pre-wrap">{turn.text}</p>
                  </div>
                </div>
                <div className={`ml-7 flex items-center gap-3 px-3 py-1.5 rounded-md border text-[12px] ${verdictBg(turn.verdict)}`}>
                  <span className={`font-bold uppercase ${verdictColor(turn.verdict)}`}>{turn.verdict}</span>
                  <span className="font-mono text-text-secondary">score: {turn.score.toFixed(3)}</span>
                  {turn.category && <span className="text-text-secondary">{turn.category}</span>}
                  <span className="text-text-tertiary">{turn.latency_ms.toFixed(0)}ms</span>
                  {turn.reason && <span className="text-text-tertiary truncate max-w-sm">{turn.reason}</span>}
                </div>
              </div>
            ))
          )}
          {sending && <div className="ml-7 text-[12px] text-text-tertiary animate-pulse">Анализ…</div>}
        </div>

        {error && <p className="text-[12px] text-status-critical px-2">{error}</p>}

        {/* Инпут */}
        <div className="flex gap-2">
          <textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendTurn(); } }}
            placeholder="Введите сообщение (Enter — отправить, Shift+Enter — перенос строки)…"
            rows={2}
            disabled={sending}
            className="flex-1 bg-surface-1 border border-border-default rounded-lg px-3 py-2 text-[13px] text-text-primary focus:outline-none focus:border-accent resize-none disabled:opacity-50"
          />
          <button
            onClick={sendTurn}
            disabled={sending || !input.trim()}
            className="px-4 py-2 bg-accent text-white rounded-lg text-[13px] font-medium hover:opacity-90 disabled:opacity-50 transition-opacity self-end flex items-center gap-1.5"
          >
            <ArrowRight className="w-3.5 h-3.5" />
            {sending ? "…" : "Отправить"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── stat card ────────────────────────────────────────────────────────────────

function StatCard({ title, value, sub, icon, accent = false, warn = false }: {
  title: string; value: string | number; sub?: string; icon: React.ReactNode; accent?: boolean; warn?: boolean;
}) {
  const bg = accent ? "bg-[rgba(229,72,77,0.12)] text-status-critical"
           : warn   ? "bg-[rgba(245,166,35,0.12)] text-status-warning"
           : "bg-surface-3 text-accent";
  return (
    <div className="content-card flex items-start gap-4 p-5">
      <div className={`p-2.5 rounded-xl ${bg}`}>{icon}</div>
      <div className="flex flex-col min-w-0">
        <span className="text-[13px] text-text-secondary">{title}</span>
        <span className="text-[24px] font-bold text-text-primary leading-tight">{value}</span>
        {sub && <span className="text-[12px] text-text-tertiary mt-0.5">{sub}</span>}
      </div>
    </div>
  );
}

// ─── statistics tab ───────────────────────────────────────────────────────────

const REASON_COLORS: Record<string, string> = {
  crescendo: "#E5484D",
  post_refusal: "#F5A623",
  self_reference: "#9758FF",
  cumulative: "#4A9EFF",
};

interface SessionSummaryMini { session_id: string; cumulative_risk_score: number; status: string; }

function StatisticsTab() {
  const { period, setPeriod, hours, label } = useStatsPeriod();
  const [stats, setStats]         = useState<LayerStatsResponse | null>(null);
  const [activeSessions, setActiveSessions] = useState<SessionSummaryMini[]>([]);
  const [loading, setLoading]     = useState(true);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      api.get<LayerStatsResponse>(`/layers/5/stats?hours=${hours}`).catch(() => null),
      api.get<SessionSummaryMini[]>("/sessions").catch(() => []),
    ]).then(([s, sessions]) => {
      setStats(s);
      setActiveSessions(Array.isArray(sessions) ? sessions : []);
    }).finally(() => setLoading(false));
  }, [hours]);

  const totals    = stats?.totals;
  const total     = totals?.total ?? 0;
  const suspicious = totals?.suspicious ?? 0;
  const passed    = totals?.passed ?? 0;
  const escalated = totals?.escalated ?? 0;
  const avgScore  = totals?.avg_score ?? null;
  const quarantined = activeSessions.filter(s => s.status === "Quarantine").length;

  const timelineData = (stats?.timeline ?? []).map(p => ({
    time: p.time, suspicious: p.suspicious, passed: p.passed, escalated: p.escalated,
  }));

  // Parse attack signal names from backend by_reason (reason strings like "crescendo=X;post_refusal=Y")
  const byReason = (() => {
    const map: Record<string, number> = {};
    (stats?.by_reason ?? []).forEach(r => {
      r.reason.split(";").forEach(part => {
        const key = part.split("=")[0].trim() || "other";
        map[key] = (map[key] ?? 0) + r.count;
      });
    });
    return Object.entries(map)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);
  })();

  const empty = (
    <div className="flex flex-col items-center justify-center gap-2 py-12 text-text-tertiary">
      <span className="text-[13px]">Данных пока нет</span>
    </div>
  );

  return (
    <div className="flex flex-col gap-6">
      {/* Period picker */}
      <div className="flex items-center justify-between">
        <span className="text-[13px] text-text-secondary">Статистика за период</span>
        <PeriodPicker value={period} onChange={setPeriod} />
      </div>

      {loading ? (
        <div className="flex justify-center p-12">
          <div className="w-7 h-7 border-2 border-accent border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
            <StatCard
              title="Активных сессий"
              value={activeSessions.length.toLocaleString()}
              sub={quarantined > 0 ? `${quarantined} в карантине` : "в реальном времени"}
              icon={<Users className="w-5 h-5" />}
              accent={quarantined > 0}
            />
            <StatCard title="Ходов проанализировано" value={total.toLocaleString()} sub={label} icon={<Activity className="w-5 h-5" />} />
            <StatCard
              title="Подозрительных"
              value={suspicious.toLocaleString()}
              sub={total ? `${((suspicious/total)*100).toFixed(1)}%` : "—"}
              icon={<AlertTriangle className="w-5 h-5" />}
              warn={suspicious > 0}
            />
            <StatCard title="Эскалировано" value={escalated.toLocaleString()} sub="к Судье (L7)" icon={<Shield className="w-5 h-5" />} />
            <StatCard
              title="Средний риск-скор"
              value={avgScore != null ? avgScore.toFixed(3) : "—"}
              sub="0 = чисто, 1 = высокий риск"
              icon={<TrendingUp className="w-5 h-5" />}
            />
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-[1fr_360px] gap-6">
            <div className="content-card flex flex-col">
              <h3 className="text-body-strong mb-4">Временной риск сессий ({label})</h3>
              {timelineData.length === 0 ? empty : (
                <div className="h-52">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={timelineData} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
                      <defs>
                        <linearGradient id="gradSusp5" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#F5A623" stopOpacity={0.3} />
                          <stop offset="95%" stopColor="#F5A623" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border-subtle)" />
                      <XAxis
                        dataKey="time" axisLine={false} tickLine={false}
                        tick={{ fill: "var(--text-tertiary)", fontSize: 10 }}
                        tickFormatter={(v) => formatTimeTick(v, hours)}
                      />
                      <YAxis axisLine={false} tickLine={false} tick={{ fill: "var(--text-tertiary)", fontSize: 10 }} allowDecimals={false} />
                      <Tooltip
                        contentStyle={{ background: "var(--surface-2)", border: "1px solid var(--border-default)", borderRadius: 8, fontSize: 12 }}
                        labelFormatter={(v) => formatTimeTick(String(v), hours)}
                      />
                      <Area type="monotone" dataKey="suspicious" stroke="#F5A623" fill="url(#gradSusp5)" strokeWidth={2} name="Подозрительных" />
                      <Area type="monotone" dataKey="escalated" stroke="#E5484D" fill="none" strokeWidth={1.5} name="Эскалировано" />
                      <Area type="monotone" dataKey="passed" stroke="var(--accent)" fill="none" strokeWidth={1.5} strokeDasharray="4 3" name="Чистых" />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>

            <div className="content-card flex flex-col">
              <h3 className="text-body-strong mb-4">Сигналы атаки ({label})</h3>
              {byReason.length === 0 ? empty : (
                <div style={{ height: Math.max(byReason.length * 44, 100) }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={byReason} layout="vertical" margin={{ left: 0, right: 36, top: 4, bottom: 4 }}>
                      <CartesianGrid horizontal={false} strokeDasharray="3 3" stroke="var(--border-subtle)" />
                      <XAxis type="number" axisLine={false} tickLine={false} tick={{ fill: "var(--text-tertiary)", fontSize: 11 }} />
                      <YAxis dataKey="name" type="category" width={120} axisLine={false} tickLine={false} tick={{ fill: "var(--text-secondary)", fontSize: 11 }} />
                      <Tooltip contentStyle={{ background: "var(--surface-2)", border: "1px solid var(--border-default)", borderRadius: 8, fontSize: 12 }} />
                      <Bar dataKey="count" barSize={18} radius={[0, 4, 4, 0]}>
                        {byReason.map((entry, i) => (
                          <Cell key={i} fill={REASON_COLORS[entry.name] ?? "#8E96A3"} fillOpacity={0.85} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ─── configuration tab ────────────────────────────────────────────────────────

function ConfigurationTab({ config, onConfigChange }: {
  config: Layer5Config;
  onConfigChange: (partial: Partial<Layer5Config>) => void;
}) {
  const ttlMin = Math.round(config.session_ttl / 60);

  return (
    <div className="flex flex-col gap-6">
      <div className="content-card flex flex-col gap-4">
        <h3 className="text-body-strong">Жизненный цикл сессии</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <label className="text-[13px] font-medium">TTL сессии</label>
              <span className="font-mono bg-surface-2 px-1.5 py-0.5 rounded border border-border-subtle text-[12px]">{ttlMin} мин</span>
            </div>
            <Slider min={5} max={60} value={ttlMin} onChangeValue={v => onConfigChange({ session_ttl: v * 60 })} />
            <span className="text-[11px] text-text-tertiary">Неактивные сессии истекают из Redis после указанного времени.</span>
          </div>
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <label className="text-[13px] font-medium">Использование эмбеддингов Слоя 3</label>
              <span className="text-[11px] px-2 py-0.5 rounded bg-surface-3 border border-border-default text-text-tertiary font-medium uppercase tracking-wider">AUTO</span>
            </div>
            <span className="text-[11px] text-text-tertiary mt-1">
              Эмбеддинги из <span className="font-mono">ctx.embedding</span> (Слой 3, Qdrant) переиспользуются без повторного вызова модели.
              Soft-поиск по attack_signatures (порог 0.5, cosine) определяет <span className="font-mono">topic_label</span> хода.
            </span>
          </div>
        </div>
      </div>

      <div className="content-card flex flex-col gap-4">
        <h3 className="text-body-strong">Веса детекторов</h3>
        <p className="text-[12px] text-text-tertiary -mt-2">
          Определяют, насколько каждый сигнал вносит вклад в точечный скор хода при срабатывании. Точечный скор ≥ 0.5 немедленно переводит ход в «подозрительный», не дожидаясь накопления.
        </p>

        <div className="flex flex-col gap-5">
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <div className="flex flex-col">
                <span className="text-[13px] font-bold">Дрейф темы (Crescendo)</span>
                <span className="text-[11px] text-text-tertiary">Постепенный сдвиг темы диалога за последние 5 ходов. Срабатывает при суммарном cosine drift ≥ crescendo_threshold.</span>
              </div>
              <span className="font-mono bg-[rgba(229,72,77,0.1)] text-status-critical px-2 py-0.5 rounded border border-[rgba(229,72,77,0.2)] text-[12px] font-bold ml-4 shrink-0">
                {config.crescendo_contribution.toFixed(2)}
              </span>
            </div>
            <Slider min={0.1} max={1.0} step={0.05} value={config.crescendo_contribution}
              onChangeValue={v => onConfigChange({ crescendo_contribution: v })} />
          </div>

          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <div className="flex flex-col">
                <span className="text-[13px] font-bold">Отказ + перефразирование</span>
                <span className="text-[11px] text-text-tertiary">Модель отказала на предыдущем ходу, а текущий запрос семантически схож с отклонённым (cosine similarity ≥ 0.7).</span>
              </div>
              <span className="font-mono bg-[rgba(245,166,35,0.1)] text-status-warning px-2 py-0.5 rounded border border-[rgba(245,166,35,0.2)] text-[12px] font-bold ml-4 shrink-0">
                {config.post_refusal_contribution.toFixed(2)}
              </span>
            </div>
            <Slider min={0.1} max={1.0} step={0.05} value={config.post_refusal_contribution}
              onChangeValue={v => onConfigChange({ post_refusal_contribution: v })} />
          </div>

          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <div className="flex flex-col">
                <span className="text-[13px] font-bold">Само-ссылка на ответ модели</span>
                <span className="text-[11px] text-text-tertiary">Пользователь ссылается на предыдущие ответы ассистента через regex-паттерны, семантическую близость или n-gram пересечение.</span>
              </div>
              <span className="font-mono bg-surface-3 px-2 py-0.5 rounded border border-border-default text-[12px] font-bold ml-4 shrink-0">
                {config.self_reference_contribution.toFixed(2)}
              </span>
            </div>
            <Slider min={0.05} max={0.5} step={0.05} value={config.self_reference_contribution}
              onChangeValue={v => onConfigChange({ self_reference_contribution: v })} />
          </div>
        </div>
      </div>

      <div className="content-card flex flex-col gap-4">
        <h3 className="text-body-strong">Накопление и пороги риска</h3>

        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="text-[13px] font-bold">Порог эскалации на L7-судью</span>
            <span className="font-mono bg-[rgba(245,166,35,0.1)] text-status-warning px-2 py-0.5 rounded border border-[rgba(245,166,35,0.2)] text-[12px] font-bold">
              {(config.escalate_threshold ?? config.risk_threshold).toFixed(2)}
            </span>
          </div>
          <Slider min={0.3} max={0.95} step={0.05} value={config.escalate_threshold ?? config.risk_threshold}
            onChangeValue={v => onConfigChange({ escalate_threshold: v, risk_threshold: v })} />
          <span className="text-[11px] text-text-tertiary">Кумулятивный риск сессии выше этого значения → вердикт «Подозрительный», L7-судья получает запрос.</span>
        </div>

        <div className="flex flex-col gap-2 pt-2 border-t border-border-subtle mt-2">
          <div className="flex items-center justify-between">
            <span className="text-[13px] font-bold">Порог карантина</span>
            <span className="font-mono bg-[rgba(229,72,77,0.1)] text-status-critical px-2 py-0.5 rounded border border-[rgba(229,72,77,0.2)] text-[12px] font-bold">
              {(config.quarantine_threshold ?? 0.85).toFixed(2)}
            </span>
          </div>
          <Slider min={0.5} max={1} step={0.05} value={config.quarantine_threshold ?? 0.85}
            onChangeValue={v => onConfigChange({ quarantine_threshold: v })} />
          <span className="text-[11px] text-text-tertiary">Выше этого значения все последующие ходы сессии автоматически помечаются «Эскалация» до конца TTL.</span>
        </div>

        <div className="flex flex-col gap-2 pt-2 border-t border-border-subtle mt-2">
          <div className="flex items-center justify-between">
            <span className="text-[13px] font-bold">Скорость затухания риска</span>
            <span className="font-mono bg-surface-3 px-2 py-0.5 rounded border border-border-default text-[12px] font-bold">
              {(config.decay_rate ?? 0.85).toFixed(2)}
            </span>
          </div>
          <Slider min={0.5} max={0.99} step={0.01} value={config.decay_rate ?? 0.85}
            onChangeValue={v => onConfigChange({ decay_rate: v })} />
          <span className="text-[11px] text-text-tertiary">score = prev × decay + delta. При 0.85 после 5 чистых ходов риск 1.0 снижается до ~0.44.</span>
        </div>

        <div className="flex flex-col gap-2 pt-2 border-t border-border-subtle mt-2">
          <div className="flex items-center justify-between">
            <span className="text-[13px] font-bold">Порог срабатывания Crescendo</span>
            <span className="font-mono bg-[rgba(245,166,35,0.1)] text-status-warning px-2 py-0.5 rounded border border-[rgba(245,166,35,0.2)] text-[12px] font-bold">
              {config.crescendo_threshold.toFixed(2)}
            </span>
          </div>
          <Slider min={0.2} max={0.9} step={0.05} value={config.crescendo_threshold} onChangeValue={v => onConfigChange({ crescendo_threshold: v })} />
          <span className="text-[11px] text-text-tertiary">Минимальный суммарный cosine drift за 5 ходов для детектирования. Дополнительно проверяется, что ни один шаг не доминирует более чем на 75% от дрейфа.</span>
        </div>
      </div>

    </div>
  );
}

// ─── main page ────────────────────────────────────────────────────────────────

export function Layer5SessionAnalysis() {
  const { status, initFromConfig, handleStatusChange } = useLayerStatus(5);
  const [activeTab, setActiveTab] = useState("Статистика");
  const [config, setConfig] = useState<Layer5Config>(DEFAULT_CONFIG);
  const saveRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    api.get<Partial<Layer5Config>>("/layers/5/config")
      .then(cfg => { setConfig({ ...DEFAULT_CONFIG, ...cfg }); initFromConfig((cfg as any).enabled); })
      .catch(() => {});
  }, []);

  const handleConfigChange = (partial: Partial<Layer5Config>) => {
    setConfig(prev => {
      const next = { ...prev, ...partial };
      if (saveRef.current) clearTimeout(saveRef.current);
      saveRef.current = setTimeout(() => {
        api.put("/layers/5/config", next).catch(() => {});
      }, 500);
      return next;
    });
  };

  return (
    <div className="flex flex-col gap-6 pb-12">
      <LayerPageHeader
        title="Слой 5 — Анализ сессий"
        subtitle="Обнаруживает многоходовые атаки в контексте диалога."
        status={status}
        onStatusChange={handleStatusChange}
      />
      {status === "DISABLED" && <LayerDisabledBanner />}

      <Tabs tabs={["Статистика", "Конфигурация", "Тестирование"]} activeTab={activeTab} onChange={setActiveTab} />

      {activeTab === "Статистика"    && <StatisticsTab />}
      {activeTab === "Конфигурация"  && <ConfigurationTab config={config} onConfigChange={handleConfigChange} />}
      {activeTab === "Тестирование"  && <SessionSimulator />}
    </div>
  );
}
