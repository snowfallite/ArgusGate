import { useState, useEffect, useCallback } from "react";
import { SectionHeader } from "@/components/SectionHeader";
import { Brain, ShieldAlert, Activity, AlertTriangle, CheckCheck, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { api } from "@/api/client";
import {
  NotificationItem,
  NotificationCategory,
  NotificationSeverity,
  useNotifications,
} from "@/hooks/useNotifications";

const CATEGORIES: { value: NotificationCategory | ""; label: string; icon: React.ReactNode }[] = [
  { value: "", label: "Все", icon: <Activity className="w-3.5 h-3.5" /> },
  { value: "training", label: "Обучение", icon: <Brain className="w-3.5 h-3.5" /> },
  { value: "security", label: "Безопасность", icon: <ShieldAlert className="w-3.5 h-3.5" /> },
  { value: "system_health", label: "Состояние системы", icon: <Activity className="w-3.5 h-3.5" /> },
];

const SEVERITY_FILTERS: { value: NotificationSeverity | ""; label: string }[] = [
  { value: "", label: "Все" },
  { value: "critical", label: "Критично" },
  { value: "error", label: "Ошибка" },
  { value: "warning", label: "Предупреждение" },
  { value: "info", label: "Инфо" },
];

function sevColor(s: NotificationSeverity) {
  if (s === "critical" || s === "error") return { bg: "rgba(229,72,77,0.10)", text: "var(--status-critical)", border: "rgba(229,72,77,0.28)" };
  if (s === "warning") return { bg: "rgba(245,166,35,0.10)", text: "var(--status-warning)", border: "rgba(245,166,35,0.28)" };
  return { bg: "rgba(74,158,255,0.08)", text: "var(--status-info)", border: "rgba(74,158,255,0.22)" };
}

function categoryIcon(cat: NotificationCategory) {
  if (cat === "training") return <Brain className="w-4 h-4" />;
  if (cat === "security") return <ShieldAlert className="w-4 h-4" />;
  return <Activity className="w-4 h-4" />;
}

export function Notifications() {
  // useNotifications даёт live-обновления через SSE
  const { markRead, markAllRead } = useNotifications({ prefetch: false });

  const [items, setItems] = useState<NotificationItem[]>([]);
  const [categoryFilter, setCategoryFilter] = useState<NotificationCategory | "">("");
  const [severityFilter, setSeverityFilter] = useState<NotificationSeverity | "">("");
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (categoryFilter) params.append("category", categoryFilter);
      if (unreadOnly) params.append("unread", "true");
      params.append("limit", "200");
      const res = await api.get<NotificationItem[]>(`/notifications?${params}`);
      const filtered = severityFilter ? res.filter(n => n.severity === severityFilter) : res;
      setItems(filtered);
    } catch {}
    setLoading(false);
  }, [categoryFilter, severityFilter, unreadOnly]);

  useEffect(() => { load(); }, [load]);

  const handleMarkRead = async (id: string) => {
    await markRead(id);
    setItems(prev => prev.map(n => n.id === id ? { ...n, read_at: new Date().toISOString() } : n));
  };

  const handleMarkAllRead = async () => {
    await markAllRead(categoryFilter || undefined);
    load();
  };

  const unreadCount = items.filter(n => !n.read_at).length;

  return (
    <div className="flex flex-col h-full gap-4 pb-6">
      <SectionHeader title="Уведомления" subtitle="История событий обучения, безопасности и состояния системы">
        <div className="flex items-center gap-2">
          {unreadCount > 0 && (
            <button onClick={handleMarkAllRead} className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-surface-2 hover:bg-surface-3 border border-border-default text-text-primary text-[13px]">
              <CheckCheck className="w-3.5 h-3.5" />
              Прочитать всё{categoryFilter ? ` (${CATEGORIES.find(c => c.value === categoryFilter)?.label})` : ""}
            </button>
          )}
          <button onClick={load} disabled={loading} className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-surface-2 hover:bg-surface-3 border border-border-default text-text-primary disabled:opacity-50">
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
            <span className="text-[13px] font-medium">Обновить</span>
          </button>
        </div>
      </SectionHeader>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1.5">
          <span className="text-[12px] text-text-secondary">Категория:</span>
          {CATEGORIES.map(c => (
            <button
              key={c.value}
              onClick={() => setCategoryFilter(c.value)}
              className={cn(
                "inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[12px] border transition-colors",
                categoryFilter === c.value
                  ? "bg-accent text-white border-accent"
                  : "bg-surface-2 text-text-secondary border-border-default hover:bg-surface-3"
              )}
            >
              {c.icon}{c.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1.5">
          <span className="text-[12px] text-text-secondary">Тип уведомления:</span>
          {SEVERITY_FILTERS.map(s => (
            <button
              key={s.value}
              onClick={() => setSeverityFilter(s.value)}
              className={cn(
                "px-2.5 py-1 rounded-md text-[12px] border transition-colors",
                severityFilter === s.value
                  ? "bg-accent text-white border-accent"
                  : "bg-surface-2 text-text-secondary border-border-default hover:bg-surface-3"
              )}
            >
              {s.label}
            </button>
          ))}
        </div>

        <label className="inline-flex items-center gap-2 text-[12px] cursor-pointer ml-auto">
          <input
            type="checkbox"
            checked={unreadOnly}
            onChange={e => setUnreadOnly(e.target.checked)}
          />
          Только непрочитанные
        </label>
      </div>

      <div className="flex-1 overflow-y-auto bg-surface-1 border border-border-subtle rounded-xl">
        {loading ? (
          <div className="p-6 space-y-2">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="h-14 bg-surface-2 rounded-lg animate-pulse" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-16 text-text-tertiary">
            <AlertTriangle className="w-10 h-10 opacity-20" />
            <span className="text-[13px]">Уведомлений не найдено</span>
          </div>
        ) : (
          <div className="divide-y divide-border-subtle">
            {items.map(n => {
              const sc = sevColor(n.severity);
              const unread = !n.read_at;
              return (
                <div
                  key={n.id}
                  className={cn(
                    "px-5 py-3 flex items-start gap-3 transition-colors",
                    unread ? "bg-[rgba(74,158,255,0.04)] hover:bg-[rgba(74,158,255,0.08)]" : "hover:bg-surface-2"
                  )}
                >
                  <div
                    className="shrink-0 w-9 h-9 rounded-lg flex items-center justify-center"
                    style={{ background: sc.bg, color: sc.text, border: `1px solid ${sc.border}` }}
                  >
                    {categoryIcon(n.category)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start gap-2 flex-wrap">
                      <span className={cn("text-[13px]", unread ? "font-semibold text-text-primary" : "text-text-secondary")}>
                        {n.title}
                      </span>
                      <span
                        className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded font-medium"
                        style={{ background: sc.bg, color: sc.text }}
                      >
                        {n.severity}
                      </span>
                      <span className="text-[10px] uppercase tracking-wider text-text-tertiary bg-surface-3 px-1.5 py-0.5 rounded">
                        {n.category}
                      </span>
                      <span className="ml-auto text-[11px] text-text-tertiary whitespace-nowrap">
                        {new Date(n.created_at).toLocaleString()}
                      </span>
                    </div>
                    {n.body && (
                      <p className="text-[12px] text-text-tertiary mt-1">{n.body}</p>
                    )}
                    {n.payload && Object.keys(n.payload).length > 0 && (
                      <details className="text-[10px] text-text-tertiary mt-1.5">
                        <summary className="cursor-pointer hover:text-text-secondary">payload</summary>
                        <pre className="font-mono mt-1 p-2 bg-surface-2 rounded overflow-x-auto">
                          {JSON.stringify(n.payload, null, 2)}
                        </pre>
                      </details>
                    )}
                  </div>
                  {unread && (
                    <button
                      onClick={() => handleMarkRead(n.id)}
                      className="text-[11px] text-text-tertiary hover:text-accent shrink-0 whitespace-nowrap mt-1"
                      title="Пометить как прочитанное"
                    >
                      ✓
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
