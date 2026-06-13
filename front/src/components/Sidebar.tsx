import { cn } from "@/lib/utils";
import { Link, useLocation } from "react-router-dom";
import {
  LayoutDashboard,
  Languages,
  FileSearch,
  Network,
  Brain,
  GitBranch,
  Radio,
  Scale,
  ScrollText,
  Users,
  UserCog,
  Rss,
  Database,
  Tags,
  Cpu,
  Package,
  Trophy,
  TestTube,
  Settings,
  Bell,
  AppWindow,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";

interface NavItem {
  title: string;
  path: string;
  icon: React.ComponentType<{ className?: string }>;
  badge?: string;
  counter?: number;
}

interface SidebarProps {
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}

const navSections: { label: string; items: NavItem[] }[] = [
  {
    label: "ОБЗОР",
    items: [{ title: "Дашборд", path: "/", icon: LayoutDashboard }],
  },
  {
    label: "СЛОИ ОБНАРУЖЕНИЯ",
    items: [
      { title: "Слой 1 — Нормализация", path: "/layer/1", icon: Languages },
      { title: "Слой 2 — Сигнатуры", path: "/layer/2", icon: FileSearch },
      { title: "Слой 3 — Векторный поиск", path: "/layer/3", icon: Network },
      { title: "Слой 4 — ML-классификатор", path: "/layer/4", icon: Brain },
      { title: "Слой 5 — Анализ сессий", path: "/layer/5", icon: GitBranch },
      { title: "Слой 6 — Выходной поток", path: "/layer/6", icon: Radio },
      { title: "Слой 7 — Судья-модель", path: "/layer/7", icon: Scale },
    ],
  },
  {
    label: "ОПЕРАЦИИ",
    items: [
      { title: "Журнал аудита", path: "/audit-log", icon: ScrollText },
      { title: "Активные сессии", path: "/active-sessions", icon: Users },
      { title: "Тест конвейера", path: "/pipeline-test", icon: TestTube },
    ],
  },
  {
    label: "ОБУЧЕНИЕ",
    items: [
      { title: "Датасеты и обучение", path: "/datasets-training", icon: Database },
    ],
  },
  {
    label: "СИСТЕМА",
    items: [
      { title: "Клиентские приложения", path: "/client-applications", icon: AppWindow },
      { title: "Уведомления", path: "/notifications", icon: Bell },
      { title: "Настройки", path: "/settings", icon: Settings },
    ],
  },
];

export function Sidebar({ collapsed = false, onToggleCollapse }: SidebarProps) {
  const location = useLocation();

  return (
    <aside
      className={cn(
        "flex flex-col glass glass--regular border border-border-subtle rounded-[16px] transition-all duration-300 z-40 fixed top-[80px] bottom-3 left-3",
        collapsed ? "w-[64px]" : "w-[280px]"
      )}
    >
      {/* Collapse toggle */}
      {onToggleCollapse && (
        <div className={cn("flex shrink-0 py-2", collapsed ? "justify-center px-2" : "justify-end px-3")}>
          <button
            onClick={onToggleCollapse}
            className="p-1.5 rounded-md text-text-tertiary hover:text-text-secondary hover:bg-surface-2 transition-colors"
            title={collapsed ? "Развернуть панель" : "Свернуть панель"}
            aria-label={collapsed ? "Развернуть панель" : "Свернуть панель"}
          >
            {collapsed
              ? <PanelLeftOpen className="w-4 h-4" />
              : <PanelLeftClose className="w-4 h-4" />
            }
          </button>
        </div>
      )}

      <div className="flex-1 overflow-y-auto py-2 scrollbar-hide">
        <div className="flex flex-col gap-6">
          {navSections.map((section, idx) => (
            <div key={idx} className="flex flex-col">
              {!collapsed && (
                <div className="px-4 mb-2">
                  <span className="text-[11px] leading-4 uppercase tracking-[0.05em] text-text-tertiary font-medium">
                    {section.label}
                  </span>
                </div>
              )}
              <div className="flex flex-col gap-0.5">
                {section.items.map((item) => {
                  const isActive = location.pathname === item.path;
                  const Icon = item.icon;
                  
                  return (
                    <Link
                      key={item.path}
                      to={item.path}
                      className={cn(
                        "group flex items-center gap-3 px-4 py-2 mx-2 rounded-md transition-colors",
                        isActive
                          ? "bg-[rgba(74,158,255,0.1)] text-accent font-medium relative before:absolute before:left-0 before:top-2 before:bottom-2 before:w-[2px] before:bg-accent before:rounded-r-full"
                          : "text-text-secondary hover:bg-surface-2 hover:text-text-primary"
                      )}
                      title={collapsed ? item.title : undefined}
                    >
                      <Icon className={cn("w-4 h-4 shrink-0", isActive ? "text-accent" : "text-text-tertiary group-hover:text-text-secondary")} />
                      {!collapsed && (
                         <div className="flex items-center justify-between flex-1 overflow-hidden">
                           <span className="text-[13px] whitespace-nowrap">{item.title}</span>
                           {(item.badge || item.counter) && (
                             <div className="flex items-center ml-2">
                               {item.badge && (
                                 <span className="px-1.5 py-0.5 rounded text-[10px] uppercase font-medium bg-surface-3 text-text-secondary">
                                   {item.badge}
                                 </span>
                               )}
                               {item.counter && (
                                 <span className="px-1.5 py-0.5 rounded-full text-[11px] font-medium bg-surface-2 text-text-secondary">
                                   {item.counter}
                                 </span>
                               )}
                             </div>
                           )}
                         </div>
                      )}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </aside>
  );
}
