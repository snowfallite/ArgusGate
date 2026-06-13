import { Outlet } from "react-router-dom";
import { useState, type CSSProperties } from "react";
import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";

export function AppShell() {
  const [collapsed, setCollapsed] = useState(() => {
    return localStorage.getItem("sidebar-collapsed") === "true";
  });

  const toggleCollapse = () => {
    setCollapsed(prev => {
      const next = !prev;
      localStorage.setItem("sidebar-collapsed", String(next));
      return next;
    });
  };

  // TopBar: fixed top-3 (12px) + h-[56px] = 68px до нижней границы + 8px зазор = 76px
  // Sidebar: collapsed=64px, expanded=280px; + 12px left offset + 12px gap = 88px / 304px
  const sidebarW = collapsed ? 88 : 304;

  const SHELL_VARS = {
    "--topbar-h": "76px",
    "--sidebar-w": `${sidebarW}px`,
  } as CSSProperties;

  return (
    <div className="flex min-h-screen bg-surface-base text-text-primary" style={SHELL_VARS}>
      {/* Top mask to hide scroll bleed above the floating TopBar's 12px gap */}
      <div className="fixed top-0 left-0 right-0 h-3 bg-surface-base z-[60]" />

      <TopBar />
      <Sidebar collapsed={collapsed} onToggleCollapse={toggleCollapse} />
      <main
        className="flex-1 min-w-0 flex flex-col pt-[76px] transition-all duration-300"
        style={{ paddingLeft: `${sidebarW}px` }}
      >
        <div className="flex-1 p-6 w-full min-w-0">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
