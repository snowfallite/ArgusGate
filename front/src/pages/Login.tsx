import { useState, useEffect } from "react";
import {
  ShieldCheck, ArrowRight, Lock, Eye, EyeOff, Sun, Moon,
  Languages, FileSearch, Network, Brain, GitBranch, Radio, Scale,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";

const LAYERS = [
  { n: 1, label: "Нормализация",      icon: Languages,  color: "#4A9EFF", desc: "Санитизация Unicode и кодировок" },
  { n: 2, label: "Сигнатуры",         icon: FileSearch, color: "#9758FF", desc: "Паттерны и ключевые слова" },
  { n: 3, label: "Векторный поиск",   icon: Network,    color: "#4A9EFF", desc: "Семантические векторы атак" },
  { n: 4, label: "ML-классификатор",  icon: Brain,      color: "#F5A623", desc: "DeBERTa prompt-injection модель" },
  { n: 5, label: "Анализ сессий",     icon: GitBranch,  color: "#46A758", desc: "Многоходовое Crescendo обнаружение" },
  { n: 6, label: "Выходной поток",    icon: Radio,      color: "#E5484D", desc: "PII и перехват canary-токена" },
  { n: 7, label: "Судья-модель",      icon: Scale,      color: "#4A9EFF", desc: "LLM-as-judge финальная проверка" },
];

function hexToRgb(hex: string) {
  return `${parseInt(hex.slice(1,3),16)},${parseInt(hex.slice(3,5),16)},${parseInt(hex.slice(5,7),16)}`;
}

function PipelineVisualization() {
  const [activeIdx, setActiveIdx] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setActiveIdx(i => (i + 1) % LAYERS.length), 1400);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="flex flex-col gap-[5px] w-full">
      {LAYERS.map((layer, i) => {
        const Icon = layer.icon;
        const active = i === activeIdx;
        const passed = i < activeIdx;
        return (
          <div
            key={layer.n}
            className="flex items-center gap-3 px-3 py-2 rounded-lg border transition-all duration-500"
            style={{
              background: active ? `rgba(${hexToRgb(layer.color)},0.1)` : passed ? "rgba(70,167,88,0.04)" : "var(--surface-2)",
              borderColor: active ? `rgba(${hexToRgb(layer.color)},0.3)` : passed ? "rgba(70,167,88,0.12)" : "var(--border-subtle)",
              transform: active ? "translateX(3px)" : "none",
            }}
          >
            <div
              className="w-7 h-7 rounded-md flex items-center justify-center shrink-0 transition-all duration-500"
              style={{ background: active ? `rgba(${hexToRgb(layer.color)},0.18)` : "var(--surface-2)" }}
            >
              <Icon
                className="w-3.5 h-3.5 transition-all duration-500"
                style={{ color: active ? layer.color : passed ? "#46A758" : "var(--text-tertiary)" }}
              />
            </div>

            <div className="flex-1 min-w-0 flex items-center gap-2">
              <span
                className="text-[11px] font-bold transition-colors duration-500 shrink-0"
                style={{ color: active ? layer.color : passed ? "#46A758" : "var(--text-tertiary)" }}
              >
                L{layer.n}
              </span>
              <span
                className="text-[13px] font-medium truncate transition-colors duration-500"
                style={{ color: active ? "var(--text-primary)" : passed ? "var(--text-tertiary)" : "var(--text-tertiary)" }}
              >
                {layer.label}
              </span>
              <span
                className="text-[11px] truncate hidden xl:block transition-colors duration-500"
                style={{ color: active ? "var(--text-secondary)" : "var(--text-tertiary)", opacity: active ? 1 : 0.5 }}
              >
                — {layer.desc}
              </span>
            </div>

            <div
              className="w-2 h-2 rounded-full shrink-0 transition-all duration-500"
              style={{
                background: active ? layer.color : passed ? "#46A758" : "var(--surface-3)",
                boxShadow: active ? `0 0 5px ${layer.color}` : "none",
              }}
            />
          </div>
        );
      })}
    </div>
  );
}

export function Login() {
  const { login } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const [theme, setTheme] = useState<"dark" | "light">(() =>
    (localStorage.getItem("theme") as "dark" | "light") ?? "dark"
  );

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  const toggleTheme = () => setTheme(prev => {
    const next = prev === "dark" ? "light" : "dark";
    localStorage.setItem("theme", next);
    return next;
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setIsLoading(true);
    try {
      await login(username, password);
    } catch {
      setError("Неверные учётные данные. Попробуйте снова.");
    } finally {
      setIsLoading(false);
    }
  };

  const inputBase: React.CSSProperties = {
    background: "var(--surface-2)",
    border: "1px solid var(--border-subtle)",
    boxShadow: "inset 0 1px 2px rgba(0,0,0,0.1)",
  };
  const inputClassName = "w-full rounded-xl px-4 py-3 text-[15px] text-text-primary placeholder:text-text-tertiary outline-none transition-all duration-200 disabled:opacity-50 focus:border-[rgba(74,158,255,0.5)] focus:bg-[rgba(74,158,255,0.04)]";

  return (
    <div className="min-h-screen overflow-y-auto flex items-center justify-center py-8 px-6 bg-surface-base">

      {/* Theme toggle */}
      <button
        onClick={toggleTheme}
        className="fixed top-5 right-5 z-20 p-2 rounded-lg text-text-secondary hover:text-text-primary hover:bg-surface-2 transition-colors"
        aria-label={theme === "dark" ? "Светлая тема" : "Тёмная тема"}
      >
        {theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
      </button>

      {/* Background */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute rounded-full" style={{ width: 600, height: 600, top: -200, left: -150, background: "radial-gradient(circle, rgba(74,158,255,0.07) 0%, transparent 70%)" }} />
        <div className="absolute rounded-full" style={{ width: 500, height: 500, bottom: -150, right: -80, background: "radial-gradient(circle, rgba(151,88,255,0.06) 0%, transparent 70%)" }} />
        <div className="absolute inset-0" style={{ backgroundImage: "linear-gradient(rgba(127,127,127,0.05) 1px,transparent 1px),linear-gradient(90deg,rgba(127,127,127,0.05) 1px,transparent 1px)", backgroundSize: "48px 48px" }} />
      </div>

      {/* Main content */}
      <div className="relative z-10 w-full max-w-[980px] flex items-center gap-12">

        {/* ── Left panel ── */}
        <div className="hidden lg:flex flex-col flex-1 gap-9">

          {/* Brand */}
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0" style={{ background: "rgba(74,158,255,0.12)", border: "1px solid rgba(74,158,255,0.2)" }}>
              <ShieldCheck className="w-5 h-5 text-accent" />
            </div>
            <div>
              <span
                style={{ fontFamily: "var(--font-display)" }}
                className="font-bold text-[17px] text-text-primary tracking-tight"
              >
                ArgusGate
              </span>
              <span className="block text-[12px] text-text-tertiary leading-tight">LLM Security Gateway</span>
            </div>
          </div>

          {/* Headline + pipeline */}
          <div className="flex flex-col gap-6">
            <div className="flex flex-col gap-3">
              <h1 className="text-[32px] font-semibold text-text-primary leading-[1.2] tracking-tight">
                Семь слоёв<br />
                <span style={{ color: "#4A9EFF" }}>интеллектуальной защиты</span>
              </h1>
              <p className="text-[14px] text-text-tertiary leading-relaxed max-w-[300px]">
                Каждый запрос проходит через конвейер обнаружения перед отправкой к LLM.
              </p>
            </div>

            <PipelineVisualization />
          </div>

          {/* Stats */}
          <div className="flex items-center gap-8">
            {[
              { label: "Слоёв обнаружения", value: "7" },
              { label: "ML модель", value: "DeBERTa v3" },
              { label: "Задержка", value: "<25 мс" },
            ].map((s) => (
              <div key={s.label} className="flex flex-col gap-0.5">
                <span className="text-[26px] font-bold text-text-primary tracking-tight leading-none">{s.value}</span>
                <span className="text-[12px] text-text-tertiary">{s.label}</span>
              </div>
            ))}
          </div>
        </div>

        {/* ── Right panel (form) ── */}
        <div className="w-full lg:w-[420px] shrink-0">
          <div
            className="w-full rounded-[20px] p-8 flex flex-col gap-6 relative overflow-hidden glass glass--thick"
            style={{ boxShadow: "0 24px 64px rgba(0,0,0,0.35)" }}
          >
            {/* Top accent line */}
            <div className="pointer-events-none absolute top-0 left-0 right-0 h-px" style={{ background: "linear-gradient(90deg, transparent, rgba(74,158,255,0.35), transparent)" }} />

            {/* Mobile brand */}
            <div className="lg:hidden flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: "rgba(74,158,255,0.12)", border: "1px solid rgba(74,158,255,0.2)" }}>
                <ShieldCheck className="w-4 h-4 text-accent" />
              </div>
              <span
                style={{ fontFamily: "var(--font-display)" }}
                className="font-bold text-[16px] text-text-primary"
              >
                ArgusGate
              </span>
            </div>

            {/* Heading */}
            <div className="flex flex-col gap-1">
              <h2 className="text-[22px] font-semibold text-text-primary tracking-tight">Добро пожаловать</h2>
              <p className="text-[14px] text-text-tertiary">Войдите в консоль безопасности</p>
            </div>

            {/* Form */}
            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              {error && (
                <div className="flex items-center gap-2 px-3.5 py-2.5 rounded-lg text-[13px]" style={{ background: "rgba(229,72,77,0.08)", border: "1px solid rgba(229,72,77,0.2)", color: "#E5484D" }}>
                  <div className="w-1.5 h-1.5 rounded-full bg-[#E5484D] shrink-0" />
                  {error}
                </div>
              )}

              <div className="flex flex-col gap-1.5">
                <label className="text-[12px] font-medium text-text-secondary pl-0.5">Имя пользователя</label>
                <input
                  type="text"
                  value={username}
                  onChange={e => setUsername(e.target.value)}
                  placeholder="admin"
                  autoComplete="username"
                  disabled={isLoading}
                  className={inputClassName}
                  style={inputBase}
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-[12px] font-medium text-text-secondary pl-0.5">Пароль</label>
                <div className="relative">
                  <input
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    placeholder="••••••••"
                    autoComplete="current-password"
                    disabled={isLoading}
                    className={`${inputClassName} pl-4 pr-11 font-mono`}
                    style={inputBase}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(v => !v)}
                    aria-label={showPassword ? "Скрыть пароль" : "Показать пароль"}
                    className="absolute right-3.5 top-1/2 -translate-y-1/2 text-text-tertiary hover:text-text-secondary transition-colors"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={isLoading || !username || !password}
                className="w-full mt-1 rounded-xl py-3 text-[15px] font-semibold flex items-center justify-center gap-2 transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed"
                style={{
                  background: isLoading || !username || !password ? "rgba(74,158,255,0.25)" : "linear-gradient(135deg,#4A9EFF 0%,#3B7FD4 100%)",
                  color: "#fff",
                  boxShadow: isLoading || !username || !password ? "none" : "0 4px 16px rgba(74,158,255,0.28), inset 0 1px 0 rgba(255,255,255,0.15)",
                }}
              >
                {isLoading
                  ? <div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                  : <><Lock className="w-4 h-4" />Войти<ArrowRight className="w-4 h-4" /></>
                }
              </button>
            </form>

            {/* Version */}
            <p className="text-center text-[11px] font-mono text-text-tertiary">
              ArgusGate v1.0.0
            </p>
          </div>
        </div>

      </div>
    </div>
  );
}
