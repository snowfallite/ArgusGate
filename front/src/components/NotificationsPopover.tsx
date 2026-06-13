import { useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { Brain, ShieldAlert, AlertTriangle, Activity, CheckCheck, X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  NotificationItem,
  NotificationCategory,
  NotificationSeverity,
} from "@/hooks/useNotifications";

function categoryIcon(cat: NotificationCategory) {
  if (cat === "training") return <Brain className="w-4 h-4" />;
  if (cat === "security") return <ShieldAlert className="w-4 h-4" />;
  return <Activity className="w-4 h-4" />;
}

function severityClass(s: NotificationSeverity): { bg: string; text: string; border: string } {
  if (s === "critical") return { bg: "rgba(229,72,77,0.12)", text: "var(--status-critical)", border: "rgba(229,72,77,0.30)" };
  if (s === "error") return { bg: "rgba(229,72,77,0.08)", text: "var(--status-critical)", border: "rgba(229,72,77,0.22)" };
  if (s === "warning") return { bg: "rgba(245,166,35,0.08)", text: "var(--status-warning)", border: "rgba(245,166,35,0.22)" };
  return { bg: "rgba(74,158,255,0.08)", text: "var(--status-info)", border: "rgba(74,158,255,0.22)" };
}

function relTime(iso: string) {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return "только что";
  if (diff < 3600) return `${Math.floor(diff / 60)}м`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}ч`;
  return new Date(iso).toLocaleDateString();
}

interface Props {
  items: NotificationItem[];
  onMarkRead: (id: string) => void;
  onMarkAllRead: () => void;
  onClose: () => void;
}

export function NotificationsPopover({ items, onMarkRead, onMarkAllRead, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    };
    // Откладываем чтобы не сработать на тот же клик что и open
    const t = setTimeout(() => document.addEventListener("mousedown", handler), 0);
    return () => {
      clearTimeout(t);
      document.removeEventListener("mousedown", handler);
    };
  }, [onClose]);

  const unreadItems = items.filter(n => !n.read_at);
  const hasUnread = unreadItems.length > 0;

  return (
    <div
      ref={ref}
      className="absolute right-0 top-full mt-[20px] w-[420px] max-h-[520px] bg-surface-1 border border-border-default rounded-xl shadow-2xl z-50 flex flex-col overflow-hidden"
    >
      <div className="flex items-center justify-between px-4 py-3 border-b border-border-subtle bg-surface-2 shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-[13px] font-medium text-text-primary">Уведомления</span>
          {hasUnread && (
            <span className="text-[11px] font-medium bg-accent text-white px-1.5 py-0.5 rounded-full">
              {unreadItems.length}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          {hasUnread && (
            <button
              onClick={onMarkAllRead}
              title="Прочитать всё"
              className="flex items-center gap-1 text-[11px] text-text-secondary hover:text-text-primary px-2 py-1 rounded-md hover:bg-surface-3 transition-colors"
            >
              <CheckCheck className="w-3 h-3" />
              Прочитать всё
            </button>
          )}
          <button
            onClick={onClose}
            className="p-1 rounded-md text-text-tertiary hover:text-text-primary hover:bg-surface-3 transition-colors"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {items.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-12 text-text-tertiary">
            <AlertTriangle className="w-8 h-8 opacity-20" />
            <span className="text-[12px]">Уведомлений нет</span>
          </div>
        ) : (
          items.slice(0, 20).map(n => {
            const sc = severityClass(n.severity);
            const unread = !n.read_at;
            return (
              <button
                key={n.id}
                onClick={() => unread && onMarkRead(n.id)}
                className={cn(
                  "w-full text-left px-4 py-3 border-b border-border-subtle hover:bg-surface-2 transition-colors flex items-start gap-3",
                  unread && "bg-[rgba(74,158,255,0.04)]"
                )}
              >
                <div
                  className="shrink-0 w-7 h-7 rounded-md flex items-center justify-center"
                  style={{ background: sc.bg, color: sc.text, border: `1px solid ${sc.border}` }}
                >
                  {categoryIcon(n.category)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-start gap-2">
                    <span className={cn("text-[12px] flex-1 truncate", unread ? "font-semibold text-text-primary" : "text-text-secondary")}>
                      {n.title}
                    </span>
                    <span className="text-[10px] text-text-tertiary shrink-0">{relTime(n.created_at)}</span>
                  </div>
                  {n.body && (
                    <p className="text-[11px] text-text-tertiary mt-0.5 line-clamp-2">{n.body}</p>
                  )}
                </div>
                {unread && (
                  <span className="shrink-0 w-1.5 h-1.5 rounded-full bg-accent mt-1" />
                )}
              </button>
            );
          })
        )}
      </div>

      <div className="px-4 py-2 border-t border-border-subtle bg-surface-2 shrink-0">
        <Link
          to="/notifications"
          onClick={onClose}
          className="text-[12px] text-accent hover:underline"
        >
          Все уведомления
        </Link>
      </div>
    </div>
  );
}
