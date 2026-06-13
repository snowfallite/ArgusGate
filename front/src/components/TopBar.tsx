import { ShieldCheck, Bell, Sun, Moon, User } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useMemo } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useNotifications, NotificationItem } from "@/hooks/useNotifications";
import { useSystemStatus, LayerStatus } from "@/hooks/useSystemStatus";
import { NotificationsPopover } from "./NotificationsPopover";
import { useState, useEffect, useRef } from "react";

const ROLE_LABELS: Record<string, string> = {
  admin: "Администратор",
  viewer: "Наблюдатель",
  operator: "Оператор",
};

function highestUnreadSeverityColor(items: NotificationItem[]): string | null {
  const unread = items.filter(n => !n.read_at);
  if (unread.length === 0) return null;
  if (unread.some(n => n.severity === "critical" || n.severity === "error")) return "var(--status-critical)";
  if (unread.some(n => n.severity === "warning")) return "var(--status-warning)";
  return "var(--status-info)";
}

function LayerDot({ layer }: { layer: LayerStatus }) {
  const loading = layer.enabled === null;
  const enabled = layer.enabled === true;

  return (
    <div className="flex flex-col items-center gap-0.5">
      <div
        className={`w-2 h-2 rounded-full transition-colors ${
          loading
            ? "bg-surface-3 animate-pulse"
            : enabled
            ? "bg-status-success"
            : "bg-status-critical"
        }`}
      />
      <span className="text-[9px] leading-none text-text-tertiary font-mono">
        L{layer.n}
      </span>
    </div>
  );
}

export function TopBar() {
  const navigate = useNavigate();
  const { username, logout, user } = useAuth();

  const [theme, setTheme] = useState<"dark" | "light">(() => {
    return (localStorage.getItem("theme") as "dark" | "light") ?? "dark";
  });
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);
  const [bellOpen, setBellOpen] = useState(false);

  const { items, unreadCount, markRead, markAllRead } = useNotifications({ maxItems: 50 });
  const badgeColor = useMemo(() => highestUnreadSeverityColor(items), [items]);

  const { layers } = useSystemStatus();

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  useEffect(() => {
    if (!userMenuOpen) return;
    const handler = (e: MouseEvent) => {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) {
        setUserMenuOpen(false);
      }
    };
    const t = setTimeout(() => document.addEventListener("mousedown", handler), 0);
    return () => { clearTimeout(t); document.removeEventListener("mousedown", handler); };
  }, [userMenuOpen]);

  const toggleTheme = () => setTheme(prev => {
    const next = prev === "dark" ? "light" : "dark";
    localStorage.setItem("theme", next);
    return next;
  });

  const roleLabel = ROLE_LABELS[user?.role ?? ""] ?? user?.role ?? "—";

  return (
    <header className="fixed top-3 left-3 right-3 h-[56px] glass glass--regular rounded-[16px] z-50 flex items-center px-4 justify-between transition-all duration-200">
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2 text-text-primary">
          <ShieldCheck className="w-5 h-5 text-accent" />
          <span className="font-semibold tracking-tight" style={{ fontFamily: "var(--font-display)" }}>ArgusGate</span>
        </div>
      </div>

      <div className="flex items-center gap-4">
        {/* Layer statuses */}
        <div className="hidden md:flex items-center">
          <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-full bg-surface-2 border border-border-subtle">
            {layers.map(layer => (
              <LayerDot key={layer.n} layer={layer} />
            ))}
          </div>
        </div>

        <div className="flex items-center gap-1">
          {/* Bell with notifications popover */}
          <div className="relative">
            <button
              onClick={() => setBellOpen(o => !o)}
              className="relative p-2 rounded-lg text-text-secondary hover:bg-surface-2 hover:text-text-primary transition-colors"
              title={unreadCount > 0 ? `${unreadCount} непрочитанных` : "Уведомления"}
              aria-label={unreadCount > 0 ? `Уведомления: ${unreadCount} непрочитанных` : "Уведомления"}
            >
              <Bell className="w-4 h-4" />
              {unreadCount > 0 && badgeColor && (
                <span
                  className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full text-[9px] font-bold text-white flex items-center justify-center border-2 border-surface-base box-content leading-none"
                  style={{ backgroundColor: badgeColor }}
                >
                  {unreadCount > 99 ? "99+" : unreadCount}
                </span>
              )}
            </button>
            {bellOpen && (
              <NotificationsPopover
                items={items}
                onMarkRead={markRead}
                onMarkAllRead={() => markAllRead()}
                onClose={() => setBellOpen(false)}
              />
            )}
          </div>

          <button
            onClick={toggleTheme}
            className="p-2 rounded-lg text-text-secondary hover:bg-surface-2 hover:text-text-primary transition-colors"
            aria-label={theme === "dark" ? "Переключить на светлую тему" : "Переключить на тёмную тему"}
          >
            {theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>

          <div className="relative" ref={userMenuRef}>
            <button
              onClick={() => setUserMenuOpen(!userMenuOpen)}
              className="flex items-center justify-center w-8 h-8 ml-2 rounded-full bg-surface-2 border border-border-default text-text-secondary hover:text-text-primary transition-colors focus:ring-2 focus:ring-accent focus:outline-none"
              aria-label="Меню пользователя"
              aria-expanded={userMenuOpen}
            >
              <User className="w-4 h-4" />
            </button>

            {userMenuOpen && (
              <>
                <div className="absolute right-0 top-full mt-[20px] w-56 bg-surface-1/90 backdrop-blur-xl rounded-xl shadow-xl border border-border-subtle overflow-hidden z-50">
                  <div className="px-4 py-3 border-b border-border-subtle bg-surface-2">
                    <p className="text-[13px] font-medium text-text-primary">{username ?? "—"}</p>
                    <p className="text-[12px] text-text-secondary truncate mt-0.5 font-mono">{roleLabel}</p>
                  </div>
                  <div className="py-1">
                    <button onClick={() => { navigate("/settings"); setUserMenuOpen(false); }} className="w-full text-left px-4 py-2 text-[13px] text-text-secondary hover:text-text-primary hover:bg-surface-2 transition-colors">
                      Настройки
                    </button>
                  </div>
                  <div className="py-1 border-t border-border-subtle">
                    <button onClick={() => logout()} className="w-full text-left px-4 py-2 text-[13px] text-status-critical hover:bg-[rgba(229,72,77,0.1)] transition-colors">
                      Выйти
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
