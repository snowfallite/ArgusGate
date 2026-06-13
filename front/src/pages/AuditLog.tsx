import { useState, useEffect, useCallback } from "react";
import { SectionHeader } from "@/components/SectionHeader";
import { StatusPill } from "@/components/StatusPill";
import { BulkLabelToolbar, LabelKind } from "@/components/audit/BulkLabelToolbar";
import {
  X, ChevronDown, ShieldCheck, HelpCircle,
  RefreshCw, Clock, MessageSquare, MessageSquareReply,
  Network, Hash, Layers, CalendarRange,
} from "lucide-react";
import { cn, verdictToStatus, normalizeVerdict as normalizeVerdictUtil } from "@/lib/utils";
import { api } from "@/api/client";

// ─── Types ────────────────────────────────────────────────────────────────────

interface AuditEvent {
  id: string;
  request_log_id: string | null;
  timestamp: string;
  layer: number;
  verdict: string | null;
  score: number | null;
  category: string | null;
  matched_rule: string | null;
  reason: string | null;
  latency_ms: number | null;
  label: string | null;
  label_category: string | null;
  label_comment: string | null;
  labeled_at: string | null;
}

interface RequestLog {
  id: string;
  timestamp: string;
  request_text: string | null;
  response_text: string | null;
  provider: string | null;
  model: string | null;
  final_verdict: string | null;
  total_latency_ms: number | null;
  session_id: string | null;
}

interface FilterState {
  unlabeledOnly: boolean;
  layer: number | "";
  verdict: string;
  fromDate: string;
  toDate: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const LAYER_NAMES: Record<number, string> = {
  1: "Нормализация", 2: "Сигнатуры", 3: "Векторы",
  4: "ML", 5: "Сессия", 6: "Выход", 7: "Судья",
};

const VERDICT_RU: Record<string, string> = {
  block: "Блок", blocked: "Блок", escalate: "Эскалация",
  suspicious: "Подозрительно", pass: "Пропуск",
};

const VERDICT_FILTER_OPTIONS = [
  { value: "", label: "Все" },
  { value: "block", label: "Блок" },
  { value: "suspicious", label: "Подозрительно" },
  { value: "escalate", label: "Эскалация" },
  { value: "pass", label: "Пропуск" },
];

const LABEL_META: Record<LabelKind, { badge: string; form: string; long: string; color: string; bg: string }> = {
  confirmed_attack: { badge: "Атака", form: "Атака",  long: "Подтверждённая атака", color: "var(--status-critical)", bg: "rgba(229,72,77,0.10)"  },
  false_positive:   { badge: "FP",    form: "Ложное", long: "Ложное срабатывание",  color: "var(--status-success)", bg: "rgba(70,167,88,0.10)"   },
  uncertain:        { badge: "?",     form: "Неясно", long: "Неопределённо",         color: "var(--status-warning)", bg: "rgba(245,166,35,0.10)"  },
};

const DEFAULT_FILTERS: FilterState = {
  unlabeledOnly: true, layer: "", verdict: "", fromDate: "", toDate: "",
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

// Используем общие утилиты из lib/utils
const normalizeVerdict = normalizeVerdictUtil;
const verdictStatus = verdictToStatus;
function tVerdict(v: string | null) { return VERDICT_RU[normalizeVerdict(v) ?? ""] ?? v ?? "—"; }

function verdictColor(v: string | null) {
  const n = normalizeVerdict(v);
  if (n === "block")       return { bg: "rgba(229,72,77,0.10)",  border: "rgba(229,72,77,0.28)",  text: "var(--status-critical)" };
  if (n === "suspicious" || n === "escalate")
                           return { bg: "rgba(245,166,35,0.10)", border: "rgba(245,166,35,0.28)", text: "var(--status-warning)"  };
  if (n === "pass")        return { bg: "rgba(70,167,88,0.08)",  border: "rgba(70,167,88,0.22)",  text: "var(--status-success)"  };
  return                          { bg: "rgba(74,158,255,0.08)", border: "rgba(74,158,255,0.22)", text: "var(--status-info)"     };
}

// ─── LabelBadge ───────────────────────────────────────────────────────────────

function LabelBadge({ label, long = false }: { label: string | null; long?: boolean }) {
  if (!label || !(label in LABEL_META)) {
    return <span className="text-text-tertiary text-[10px]">—</span>;
  }
  const m = LABEL_META[label as LabelKind];
  return (
    <span className="text-[10px] px-1.5 py-0.5 rounded font-medium" style={{ color: m.color, background: m.bg }}>
      {long ? m.long : m.badge}
    </span>
  );
}

// ─── MetaCell ─────────────────────────────────────────────────────────────────

function MetaCell({ label, value, icon }: { label: string; value: string; icon?: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1 rounded-xl px-3 py-2.5"
      style={{ background: "rgba(255,255,255,0.025)", border: "1px solid var(--border-subtle)" }}>
      <div className="flex items-center gap-1.5 text-text-tertiary">
        {icon}
        <span className="text-[10px] uppercase tracking-wider font-medium">{label}</span>
      </div>
      <span className="text-[12px] font-mono text-text-primary truncate" title={value}>{value}</span>
    </div>
  );
}

// ─── Section accordion ────────────────────────────────────────────────────────

function Section({ id, title, icon, badge, open, onToggle, children }: {
  id: string; title: string; icon: React.ReactNode; badge?: React.ReactNode;
  open: boolean; onToggle: (id: string) => void; children: React.ReactNode;
}) {
  return (
    <div className="border-t border-border-subtle">
      <button onClick={() => onToggle(id)}
        className="flex items-center w-full px-6 py-3.5 hover:bg-white/[0.02] transition-colors">
        <div className="mr-2 shrink-0 transition-transform duration-200"
          style={{ transform: open ? "rotate(0deg)" : "rotate(-90deg)" }}>
          <ChevronDown className="w-3.5 h-3.5 text-text-tertiary" />
        </div>
        {icon}
        <span className="ml-2 text-[12px] font-semibold text-text-secondary uppercase tracking-wider">{title}</span>
        {badge != null && <span className="ml-auto">{badge}</span>}
      </button>
      <div style={{ display: "grid", gridTemplateRows: open ? "1fr" : "0fr", transition: "grid-template-rows 0.22s ease" }}>
        <div style={{ overflow: "hidden" }}>
          <div className="px-6 pb-5">{children}</div>
        </div>
      </div>
    </div>
  );
}

// ─── PipelineBar ──────────────────────────────────────────────────────────────

function PipelineBar({ detections, requestVerdict, highlightLayer }: {
  detections: AuditEvent[]; requestVerdict: string | null; highlightLayer?: number;
}) {
  const byLayer: Record<number, AuditEvent> = {};
  detections.forEach(d => { byLayer[d.layer] = d; });
  const isBlocked = normalizeVerdict(requestVerdict) === "block";
  let hitBlock = false;

  return (
    <div className="flex items-center gap-1 flex-wrap">
      {[1, 2, 3, 4, 5, 6, 7].map((n, i) => {
        const det = byLayer[n];
        const v = det ? normalizeVerdict(det.verdict) : null;
        const isBlock = !!det && (v === "block" || v === "escalate");
        const isSusp  = !!det && v === "suspicious";
        if (isBlocked && isBlock && !hitBlock) hitBlock = true;

        let bg = "rgba(70,167,88,0.15)", border = "rgba(70,167,88,0.3)", tc = "var(--status-success)";
        if (isBlock) { bg = "rgba(229,72,77,0.15)";  border = "rgba(229,72,77,0.35)";  tc = "var(--status-critical)"; }
        else if (isSusp) { bg = "rgba(245,166,35,0.15)"; border = "rgba(245,166,35,0.35)"; tc = "var(--status-warning)"; }

        const hl = highlightLayer === n;
        return (
          <div key={n} className="flex items-center gap-1">
            {i > 0 && (
              <div className="w-3 h-px" style={{
                background: isBlock ? "rgba(229,72,77,0.4)" : isSusp ? "rgba(245,166,35,0.4)" : "rgba(70,167,88,0.3)"
              }} />
            )}
            <div className="flex flex-col items-center gap-0.5 px-2 py-1 rounded-md"
              style={{
                background: bg,
                border: `${hl ? 2 : 1}px solid ${hl ? tc : border}`,
                boxShadow: hl ? `0 0 0 2px ${tc}25` : undefined,
              }}
              title={`L${n}: ${LAYER_NAMES[n]} — ${det ? tVerdict(det.verdict) : "Пропуск"}`}>
              <span className="text-[10px] font-bold" style={{ color: tc }}>L{n}</span>
              <span className="text-[8px] font-medium" style={{ color: tc, opacity: 0.8 }}>
                {det ? tVerdict(det.verdict).slice(0, 5) : "ОК"}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── useAuditEvents hook ──────────────────────────────────────────────────────

function useAuditEvents() {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams();
      if (filters.unlabeledOnly) p.append("labeled", "false");
      if (filters.layer !== "")  p.append("layer", String(filters.layer));
      if (filters.verdict)       p.append("verdict", filters.verdict);
      if (filters.fromDate && filters.toDate) {
        p.append("from_date", new Date(filters.fromDate + "T00:00:00").toISOString());
        p.append("to_date",   new Date(filters.toDate   + "T23:59:59.999").toISOString());
      }
      p.append("limit", "200");
      setEvents(await api.get<AuditEvent[]>(`/audit?${p}`));
    } catch {}
    setLoading(false);
  }, [filters]);

  useEffect(() => { load(); }, [load]);

  const setFilter = useCallback(<K extends keyof FilterState>(key: K, val: FilterState[K]) => {
    setFilters(prev => ({ ...prev, [key]: val }));
  }, []);

  const updateEvent = useCallback((updated: AuditEvent) => {
    setEvents(prev => prev.map(e => e.id === updated.id ? updated : e));
  }, []);

  return { events, loading, load, filters, setFilter, setFilters, updateEvent };
}

// ─── LabelForm ────────────────────────────────────────────────────────────────

function LabelForm({ event, categories, onSaved }: {
  event: AuditEvent; categories: string[]; onSaved: (updated: AuditEvent) => void;
}) {
  const [mode, setMode]   = useState<"view" | "edit">(event.label ? "view" : "edit");
  const [pick, setPick]   = useState<LabelKind>((event.label as LabelKind | null) ?? "confirmed_attack");
  const [cat, setCat]     = useState(event.label_category ?? "");
  const [note, setNote]   = useState(event.label_comment ?? "");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg]     = useState<{ ok: boolean; text: string } | null>(null);

  const save = async () => {
    setSaving(true); setMsg(null);
    try {
      const updated = await api.post<AuditEvent>(`/audit/${event.id}/label`, {
        label: pick, label_category: cat || null, label_comment: note || null,
      });
      setMsg({ ok: true, text: "Метка сохранена" });
      setMode("view");
      onSaved(updated);
    } catch (e: any) {
      setMsg({ ok: false, text: e.message || "Ошибка при сохранении" });
    }
    setSaving(false);
  };

  if (mode === "view" && event.label) {
    const m = LABEL_META[event.label as LabelKind];
    return (
      <div className="bg-surface-2 rounded-xl p-4 flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <span className="text-[13px] font-semibold" style={{ color: m?.color }}>{m?.long ?? event.label}</span>
          {event.labeled_at && (
            <span className="text-[11px] text-text-tertiary">{new Date(event.labeled_at).toLocaleString()}</span>
          )}
        </div>
        {event.label_category && <div className="text-[12px] text-text-secondary">Категория: {event.label_category}</div>}
        {event.label_comment   && <div className="text-[12px] text-text-secondary">{event.label_comment}</div>}
        {msg && (
          <div className={`text-[11px] ${msg.ok ? "text-status-success" : "text-status-critical"}`}>{msg.text}</div>
        )}
        <button onClick={() => setMode("edit")}
          className="text-[11px] text-text-tertiary hover:text-text-secondary self-start underline underline-offset-2">
          Изменить метку
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-2">
        {(Object.entries(LABEL_META) as [LabelKind, typeof LABEL_META[LabelKind]][]).map(([k, m]) => (
          <label key={k}
            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl border cursor-pointer text-[12px] font-medium transition-all"
            style={pick === k
              ? { color: m.color, background: m.bg, borderColor: m.color + "55" }
              : { color: "var(--text-secondary)", borderColor: "var(--border-default)", background: "var(--surface-2)" }}>
            <input type="radio" name={`label-${event.id}`} value={k} checked={pick === k}
              onChange={() => setPick(k)} className="sr-only" />
            {m.form}
          </label>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="flex flex-col gap-1">
          <label className="text-[10px] text-text-tertiary uppercase tracking-wider font-medium">Категория</label>
          <input list={`cats-${event.id}`} value={cat} onChange={e => setCat(e.target.value)}
            placeholder="jailbreak, prompt-injection…"
            className="bg-surface-2 border border-border-default rounded-lg px-3 py-2 text-[12px] focus:outline-none focus:border-accent" />
          <datalist id={`cats-${event.id}`}>
            {categories.map(c => <option key={c} value={c} />)}
          </datalist>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[10px] text-text-tertiary uppercase tracking-wider font-medium">Комментарий</label>
          <input value={note} onChange={e => setNote(e.target.value)} placeholder="Заметки аналитика…"
            className="bg-surface-2 border border-border-default rounded-lg px-3 py-2 text-[12px] focus:outline-none focus:border-accent" />
        </div>
      </div>

      {msg && (
        <div className={`text-[12px] px-3 py-2 rounded-lg ${msg.ok
          ? "text-status-success bg-[rgba(70,167,88,0.08)]"
          : "text-status-critical bg-[rgba(229,72,77,0.08)]"}`}>
          {msg.text}
        </div>
      )}

      <div className="flex items-center gap-2">
        <button onClick={save} disabled={saving}
          className="px-4 py-2 bg-accent text-white rounded-lg text-[12px] font-medium hover:opacity-90 disabled:opacity-50">
          {saving ? "Сохранение…" : "Сохранить метку"}
        </button>
        {event.label && (
          <button onClick={() => setMode("view")}
            className="px-4 py-2 text-text-secondary text-[12px] hover:text-text-primary transition-colors">
            Отмена
          </button>
        )}
      </div>
    </div>
  );
}

// ─── EventDetailModal ─────────────────────────────────────────────────────────

function EventDetailModal({ event, categories, onClose, onLabeled }: {
  event: AuditEvent; categories: string[];
  onClose: () => void; onLabeled: (updated: AuditEvent) => void;
}) {
  const [localEv, setLocalEv]       = useState(event);
  const [request, setRequest]       = useState<RequestLog | null>(null);
  const [siblings, setSiblings]     = useState<AuditEvent[]>([]);
  const [loadingCtx, setLoadingCtx] = useState(!!event.request_log_id);
  const [open, setOpen]             = useState<Set<string>>(new Set(["label", "reason", "pipeline", "request"]));

  useEffect(() => {
    if (!event.request_log_id) { setLoadingCtx(false); return; }
    setLoadingCtx(true);
    Promise.all([
      api.get<RequestLog>(`/audit/requests/${event.request_log_id}`).catch(() => null),
      api.get<AuditEvent[]>(`/audit?request_id=${event.request_log_id}&limit=20`).catch(() => []),
    ]).then(([req, sibs]) => {
      setRequest(req);
      setSiblings(sibs);
    }).finally(() => setLoadingCtx(false));
  }, [event.request_log_id]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  }, [onClose]);

  const toggle = useCallback((s: string) => {
    setOpen(prev => { const n = new Set(prev); n.has(s) ? n.delete(s) : n.add(s); return n; });
  }, []);

  const handleSaved = useCallback((updated: AuditEvent) => {
    setLocalEv(updated);
    onLabeled(updated);
  }, [onLabeled]);

  const vc = verdictColor(localEv.verdict);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ paddingTop: "var(--topbar-h, 72px)", paddingBottom: "16px", paddingLeft: "calc(var(--sidebar-w, 280px) + 16px)", paddingRight: "16px" }}>
      <div className="absolute inset-0 bg-black/50" style={{ backdropFilter: "blur(3px)" }} onClick={onClose} />

      <div className="relative w-full max-w-[720px] bg-surface-1 rounded-2xl shadow-2xl flex flex-col overflow-hidden"
        style={{ maxHeight: "calc(100vh - 108px)", border: "1px solid var(--border-subtle)" }}>

        {/* Accent bar */}
        <div className="h-1 w-full shrink-0" style={{ background: vc.text, opacity: 0.7 }} />

        {/* Header */}
        <div className="flex items-start justify-between px-6 py-4 bg-surface-2 shrink-0">
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center gap-2.5 flex-wrap">
              <span className="text-[11px] font-bold px-2 py-0.5 rounded-md"
                style={{ background: vc.bg, color: vc.text, border: `1px solid ${vc.border}` }}>
                L{localEv.layer} · {LAYER_NAMES[localEv.layer]}
              </span>
              <StatusPill status={verdictStatus(localEv.verdict)} label={tVerdict(localEv.verdict)} />
              {localEv.label && <LabelBadge label={localEv.label} long />}
            </div>
            <div className="flex items-center gap-3 text-[12px] text-text-tertiary flex-wrap">
              <span className="flex items-center gap-1.5 font-mono">
                <Hash className="w-3 h-3" />{localEv.id}
              </span>
              <span className="flex items-center gap-1.5">
                <Clock className="w-3 h-3" />{new Date(localEv.timestamp).toLocaleString()}
              </span>
              {request?.model && (
                <span className="text-[12px] text-text-tertiary font-mono">{request.model}</span>
              )}
            </div>
          </div>
          <button onClick={onClose}
            className="p-1.5 rounded-lg text-text-secondary hover:bg-surface-3 hover:text-text-primary transition-colors mt-0.5">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto">

          {/* Metadata grid */}
          <div className="px-6 py-4 grid grid-cols-4 gap-2.5">
            <MetaCell label="Оценка"   value={localEv.score     != null ? localEv.score.toFixed(3)         : "—"} />
            <MetaCell label="Задержка" value={localEv.latency_ms != null ? `${localEv.latency_ms.toFixed(0)} мс` : "—"}
              icon={<Clock className="w-3.5 h-3.5" />} />
            <MetaCell label="Категория" value={localEv.category ?? "—"} />
            <MetaCell label="Провайдер" value={request?.provider ?? (loadingCtx ? "…" : "—")}
              icon={<Network className="w-3.5 h-3.5" />} />
          </div>

          {localEv.matched_rule && (
            <div className="px-6 pb-3">
              <div className="font-mono text-[11px] text-text-secondary bg-surface-2 border border-border-subtle rounded-lg px-3 py-2">
                ↳ {localEv.matched_rule}
              </div>
            </div>
          )}

          {/* Label */}
          <Section id="label" title="Метка для обучения" open={open.has("label")} onToggle={toggle}
            icon={<Layers className="w-3.5 h-3.5 text-text-secondary shrink-0" />}>
            <LabelForm
              key={localEv.id + (localEv.label ?? "none")}
              event={localEv}
              categories={categories}
              onSaved={handleSaved}
            />
          </Section>

          {/* Reason */}
          {localEv.reason && (
            <Section id="reason" title="Причина срабатывания" open={open.has("reason")} onToggle={toggle}
              icon={<HelpCircle className="w-3.5 h-3.5 text-text-tertiary shrink-0" />}>
              <p className="text-[12px] text-text-secondary leading-relaxed">{localEv.reason}</p>
            </Section>
          )}

          {/* Pipeline */}
          <Section id="pipeline" title="Конвейер слоёв" open={open.has("pipeline")} onToggle={toggle}
            icon={<Layers className="w-3.5 h-3.5 text-text-tertiary shrink-0" />}
            badge={loadingCtx
              ? <div className="w-3 h-3 border border-accent border-t-transparent rounded-full animate-spin" />
              : null}>
            {loadingCtx ? (
              <div className="h-12 bg-surface-2 rounded-lg animate-pulse" />
            ) : siblings.length > 0 ? (
              <div className="flex flex-col gap-3">
                <PipelineBar detections={siblings} requestVerdict={request?.final_verdict ?? null} highlightLayer={localEv.layer} />
                <div className="flex flex-col gap-2 mt-1">
                  {siblings.map(det => {
                    const dc = verdictColor(det.verdict);
                    const isCurrent = det.layer === localEv.layer;
                    return (
                      <div key={det.id}
                        className="flex flex-col gap-2 rounded-xl px-4 py-3"
                        style={{ background: dc.bg, border: `${isCurrent ? 2 : 1}px solid ${isCurrent ? dc.text : dc.border}` }}>
                        {/* Заголовок: слой в одну строку */}
                        <div className="flex items-center justify-between">
                          <span className="text-[11px] font-bold px-2 py-0.5 rounded-md"
                            style={{ background: "rgba(0,0,0,0.18)", color: dc.text }}>
                            L{det.layer} · {LAYER_NAMES[det.layer]}
                          </span>
                          {det.latency_ms != null && (
                            <span className="text-[10px] text-text-tertiary font-mono">
                              {det.latency_ms.toFixed(0)} мс
                            </span>
                          )}
                        </div>
                        {/* Детали */}
                        <div className="flex flex-col gap-1">
                          <div className="flex items-center gap-2">
                            <StatusPill status={verdictStatus(det.verdict)} label={tVerdict(det.verdict)} />
                            {det.score != null && (
                              <span className="text-[11px] font-mono text-text-tertiary">{det.score.toFixed(3)}</span>
                            )}
                          </div>
                          {det.category     && <span className="text-[11px] text-text-secondary">Категория: {det.category}</span>}
                          {det.matched_rule && <span className="font-mono text-[11px] text-text-secondary truncate">↳ {det.matched_rule}</span>}
                          {det.reason       && <span className="text-[11px] text-text-tertiary leading-snug">{det.reason}</span>}
                          {det.label        && <div className="mt-0.5"><LabelBadge label={det.label} long /></div>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-2 text-[12px] text-text-tertiary py-2">
                <ShieldCheck className="w-4 h-4 text-status-success" />
                {localEv.request_log_id ? "Конвейер недоступен" : "Событие не привязано к запросу"}
              </div>
            )}
          </Section>

          {/* Request text */}
          <Section id="request" title="Текст запроса" open={open.has("request")} onToggle={toggle}
            icon={<MessageSquare className="w-3.5 h-3.5 text-accent shrink-0" />}>
            {loadingCtx ? (
              <div className="h-20 bg-surface-2 rounded-lg animate-pulse" />
            ) : request?.request_text ? (
              <pre className="whitespace-pre-wrap break-words font-mono text-[12px] text-text-primary bg-surface-2 border border-border-subtle rounded-xl p-4 max-h-52 overflow-y-auto leading-relaxed">
                {request.request_text}
              </pre>
            ) : (
              <span className="text-[12px] text-text-tertiary italic">
                {localEv.request_log_id ? "Не удалось загрузить запрос" : "Нет привязанного запроса"}
              </span>
            )}
          </Section>

          {/* Response */}
          <Section id="response" title="Ответ модели" open={open.has("response")} onToggle={toggle}
            icon={<MessageSquareReply className="w-3.5 h-3.5 text-text-secondary shrink-0" />}>
            {loadingCtx ? (
              <div className="h-12 bg-surface-2 rounded-lg animate-pulse" />
            ) : request?.response_text ? (
              <pre className="whitespace-pre-wrap break-words font-mono text-[12px] text-text-primary bg-surface-2 border border-border-subtle rounded-xl p-4 max-h-52 overflow-y-auto leading-relaxed">
                {request.response_text}
              </pre>
            ) : (
              <span className="text-[12px] text-text-tertiary italic">
                {normalizeVerdict(request?.final_verdict ?? null) === "block"
                  ? "Запрос заблокирован — ответ не получен"
                  : "Ответ не сохранён"}
              </span>
            )}
          </Section>

          <div className="h-2" />
        </div>
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export function AuditLog() {
  const { events, loading, load, filters, setFilter, setFilters, updateEvent } = useAuditEvents();

  const [selectedIds, setSelectedIds]   = useState<Set<string>>(new Set());
  const [activeIndex, setActiveIndex]   = useState<number | null>(null);
  const [modalEvent, setModalEvent]     = useState<AuditEvent | null>(null);
  const [labelingNow, setLabelingNow]   = useState<Record<string, boolean>>({});
  const [categories, setCategories]     = useState<string[]>([]);

  useEffect(() => {
    api.get<{ categories: string[] }>("/audit/categories")
      .then(r => setCategories(r.categories)).catch(() => {});
  }, []);

  // ─── Selection ───────────────────────────────────────────────────────────────

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }, []);
  const selectAll    = useCallback(() => setSelectedIds(new Set(events.map(e => e.id))), [events]);
  const clearSel     = useCallback(() => setSelectedIds(new Set()), []);

  // ─── Quick label ─────────────────────────────────────────────────────────────

  const quickLabel = useCallback(async (eventId: string, label: LabelKind) => {
    setLabelingNow(prev => ({ ...prev, [eventId]: true }));
    try {
      const updated = await api.post<AuditEvent>(`/audit/${eventId}/label`, {
        label, label_category: null, label_comment: null,
      });
      updateEvent(updated);
    } catch {}
    setLabelingNow(prev => ({ ...prev, [eventId]: false }));
  }, [updateEvent]);

  // ─── Keyboard shortcuts ───────────────────────────────────────────────────────

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (modalEvent) return;
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (activeIndex === null || events.length === 0) return;

      const advance = () => setActiveIndex(i => Math.min(events.length - 1, (i ?? 0) + 1));
      const retreat = () => setActiveIndex(i => Math.max(0, (i ?? 0) - 1));

      if (e.key === "ArrowDown" || e.key.toLowerCase() === "n") {
        e.preventDefault(); advance();
      } else if (e.key === "ArrowUp" || e.key.toLowerCase() === "p") {
        e.preventDefault(); retreat();
      } else if (e.key.toLowerCase() === "a") {
        e.preventDefault(); quickLabel(events[activeIndex].id, "confirmed_attack"); advance();
      } else if (e.key.toLowerCase() === "f") {
        e.preventDefault(); quickLabel(events[activeIndex].id, "false_positive"); advance();
      } else if (e.key.toLowerCase() === "u") {
        e.preventDefault(); quickLabel(events[activeIndex].id, "uncertain"); advance();
      } else if (e.key === " ") {
        e.preventDefault(); toggleSelect(events[activeIndex].id);
      } else if (e.key === "Enter") {
        e.preventDefault(); setModalEvent(events[activeIndex]);
      }
    };
    document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  }, [activeIndex, events, modalEvent, quickLabel, toggleSelect]);

  return (
    <div className="flex flex-col h-full gap-4 pb-6">
      <SectionHeader
        title="Журнал аудита"
        subtitle="События обнаружения, разметка данных и просмотр запросов"
      />

      {/* ─── Filter bar ─── */}
      <div className="flex items-center gap-2 flex-wrap">

        {/* Unlabeled toggle */}
        <label className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-border-default bg-surface-2 cursor-pointer select-none hover:bg-surface-3 transition-colors">
          <div className="relative w-8 h-4 rounded-full transition-colors shrink-0"
            style={{ background: filters.unlabeledOnly ? "var(--accent)" : "rgba(255,255,255,0.1)" }}>
            <div className="absolute top-0.5 w-3 h-3 rounded-full bg-white shadow transition-all"
              style={{ left: filters.unlabeledOnly ? "calc(100% - 14px)" : "2px" }} />
          </div>
          <input type="checkbox" checked={filters.unlabeledOnly}
            onChange={e => setFilter("unlabeledOnly", e.target.checked)} className="sr-only" />
          <span className="text-[12px] text-text-secondary whitespace-nowrap">Без метки</span>
        </label>

        {/* Layer */}
        <select value={filters.layer}
          onChange={e => setFilter("layer", e.target.value === "" ? "" : Number(e.target.value))}
          className="bg-surface-2 border border-border-default rounded-lg px-2.5 py-1.5 text-[12px] text-text-secondary focus:outline-none focus:border-accent">
          <option value="">Все слои</option>
          {[1, 2, 3, 4, 5, 6, 7].map(n => (
            <option key={n} value={n}>L{n} — {LAYER_NAMES[n]}</option>
          ))}
        </select>

        {/* Verdict */}
        <div className="flex rounded-lg overflow-hidden border border-border-default">
          {VERDICT_FILTER_OPTIONS.map(opt => (
            <button key={opt.value} onClick={() => setFilter("verdict", opt.value)}
              className={cn(
                "px-2.5 py-1.5 text-[12px] font-medium transition-colors",
                filters.verdict === opt.value
                  ? "bg-accent text-white"
                  : "bg-surface-2 text-text-secondary hover:bg-surface-3"
              )}>
              {opt.label}
            </button>
          ))}
        </div>

        {/* Date range */}
        <div className="flex items-center gap-1.5">
          <CalendarRange className="w-3.5 h-3.5 text-text-tertiary shrink-0" />
          <input type="date" value={filters.fromDate}
            onChange={e => setFilter("fromDate", e.target.value)}
            title="Начальная дата" aria-label="Начальная дата"
            className="bg-surface-2 border border-border-default rounded-lg px-2.5 py-1.5 text-[12px] text-text-secondary focus:outline-none focus:border-accent" />
          <span className="text-text-tertiary text-[12px]">—</span>
          <input type="date" value={filters.toDate}
            onChange={e => setFilter("toDate", e.target.value)}
            title="Конечная дата" aria-label="Конечная дата"
            className="bg-surface-2 border border-border-default rounded-lg px-2.5 py-1.5 text-[12px] text-text-secondary focus:outline-none focus:border-accent" />
          {(filters.fromDate || filters.toDate) && (
            <button onClick={() => setFilters(f => ({ ...f, fromDate: "", toDate: "" }))}
              title="Сбросить период"
              className="p-1 text-text-tertiary hover:text-text-secondary rounded transition-colors">
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        <span className="text-[12px] text-text-tertiary ml-auto">{events.length} событий</span>

        <button onClick={load} disabled={loading}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-surface-2 hover:bg-surface-3 border border-border-default text-text-primary disabled:opacity-50 text-[12px]">
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
          Обновить
        </button>
      </div>

      {/* Bulk toolbar */}
      {selectedIds.size > 0 && (
        <BulkLabelToolbar
          selectedIds={Array.from(selectedIds)}
          onClear={clearSel}
          onApplied={() => { load(); clearSel(); }}
        />
      )}

      {/* Keyboard hint */}
      <div className="text-[11px] text-text-tertiary flex items-center gap-2 flex-wrap">
        <span>Горячие клавиши:</span>
        {([ ["A","Атака"], ["F","FP"], ["U","Неясно"], ["N/P","↓↑"], ["Space","Выбрать"], ["Enter","Открыть"], ["Esc","Закрыть"] ] as [string,string][]).map(([k, v]) => (
          <span key={k} className="inline-flex items-center gap-1">
            <kbd className="bg-surface-3 px-1.5 py-0.5 rounded text-[10px] font-mono">{k}</kbd>
            <span>{v}</span>
          </span>
        ))}
      </div>

      {/* ─── Events table ─── */}
      <div className="content-card flex-1 p-0 overflow-hidden flex flex-col">
        <div className="flex-1 overflow-auto rounded-xl">
          <table className="w-full text-[12px] text-left border-collapse">
            <thead className="bg-surface-2 sticky top-0 z-10 border-b border-border-subtle">
              <tr>
                <th className="px-3 py-2 w-8">
                  <input type="checkbox"
                    checked={events.length > 0 && selectedIds.size === events.length}
                    onChange={e => e.target.checked ? selectAll() : clearSel()} />
                </th>
                <th className="px-2 py-2 font-medium text-text-secondary whitespace-nowrap">Время</th>
                <th className="px-2 py-2 font-medium text-text-secondary whitespace-nowrap">Слой</th>
                <th className="px-2 py-2 font-medium text-text-secondary whitespace-nowrap">Вердикт</th>
                <th className="px-2 py-2 font-medium text-text-secondary whitespace-nowrap">Категория</th>
                <th className="px-2 py-2 font-medium text-text-secondary w-full">Причина</th>
                <th className="px-2 py-2 font-medium text-text-secondary whitespace-nowrap">Метка</th>
                <th className="px-2 py-2 font-medium text-text-secondary whitespace-nowrap w-[120px]">Разметка</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-subtle bg-surface-1">
              {loading ? (
                Array.from({ length: 10 }).map((_, i) => (
                  <tr key={i}><td colSpan={8} className="px-3 py-2">
                    <div className="h-4 bg-surface-2 rounded animate-pulse" style={{ opacity: 1 - i * 0.08 }} />
                  </td></tr>
                ))
              ) : events.length === 0 ? (
                <tr><td colSpan={8} className="px-3 py-12 text-center">
                  <div className="flex flex-col items-center gap-2 text-text-tertiary">
                    <ShieldCheck className="w-8 h-8 opacity-30" />
                    <span className="text-[13px]">
                      {filters.unlabeledOnly
                        ? "Все события размечены — снимите фильтр «Без метки»"
                        : "Событий нет"}
                    </span>
                  </div>
                </td></tr>
              ) : (
                events.map((ev, idx) => {
                  const selected = selectedIds.has(ev.id);
                  const isActive = activeIndex === idx;
                  return (
                    <tr key={ev.id}
                      onClick={() => { setActiveIndex(idx); setModalEvent(ev); }}
                      className={cn(
                        "hover:bg-surface-2 transition-colors cursor-pointer",
                        selected  && "bg-[rgba(74,158,255,0.08)]",
                        isActive  && "outline outline-2 -outline-offset-2 outline-accent",
                      )}>
                      <td className="px-3 py-2" onClick={e => e.stopPropagation()}>
                        <input type="checkbox" checked={selected} onChange={() => toggleSelect(ev.id)} />
                      </td>
                      <td className="px-2 py-2 font-mono text-text-tertiary text-[11px] whitespace-nowrap">
                        {new Date(ev.timestamp).toLocaleString()}
                      </td>
                      <td className="px-2 py-2 text-text-secondary font-mono whitespace-nowrap">
                        <span title={LAYER_NAMES[ev.layer]}>L{ev.layer}</span>
                      </td>
                      <td className="px-2 py-2 whitespace-nowrap">
                        <StatusPill status={verdictStatus(ev.verdict)} label={tVerdict(ev.verdict)} />
                      </td>
                      <td className="px-2 py-2 text-text-secondary whitespace-nowrap">
                        {ev.category ?? "—"}
                      </td>
                      <td className="px-2 py-2 text-text-tertiary text-[11px] max-w-0">
                        <span className="block truncate">{ev.reason ?? "—"}</span>
                      </td>
                      <td className="px-2 py-2">
                        <LabelBadge label={ev.label} />
                      </td>
                      <td className="px-2 py-2" onClick={e => e.stopPropagation()}>
                        <div className="flex items-center gap-1">
                          {(Object.entries(LABEL_META) as [LabelKind, typeof LABEL_META[LabelKind]][]).map(([kind, m]) => {
                            const isMarked = ev.label === kind;
                            const letter = kind === "confirmed_attack" ? "A" : kind === "false_positive" ? "F" : "U";
                            return (
                              <button key={kind} disabled={!!labelingNow[ev.id]}
                                onClick={() => quickLabel(ev.id, kind)}
                                title={m.long}
                                className="w-7 h-6 rounded text-[10px] font-bold border transition-colors"
                                style={{
                                  background:  isMarked ? m.color : "rgba(255,255,255,0.04)",
                                  color:       isMarked ? "white"  : m.color,
                                  borderColor: isMarked ? m.color  : "var(--border-default)",
                                }}>
                                {letter}
                              </button>
                            );
                          })}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Event detail modal */}
      {modalEvent && (
        <EventDetailModal
          event={modalEvent}
          categories={categories}
          onClose={() => setModalEvent(null)}
          onLabeled={updateEvent}
        />
      )}
    </div>
  );
}
