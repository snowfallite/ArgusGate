import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { SectionHeader } from "@/components/SectionHeader";
import { Tabs } from "@/components/Tabs";
import { DatasetsTab } from "@/components/datasets-training/DatasetsTab";
import { JobsTab } from "@/components/datasets-training/JobsTab";
import { ModelsTab } from "@/components/datasets-training/ModelsTab";
import { TrainingConfigTab } from "@/components/datasets-training/TrainingConfigTab";

type TabKey = "datasets" | "jobs" | "models" | "config";

const TAB_LABELS: { key: TabKey; label: string }[] = [
  { key: "datasets", label: "Датасеты" },
  { key: "jobs", label: "Задачи обучения" },
  { key: "models", label: "Модели" },
  { key: "config", label: "Конфигурация" },
];

const VALID_TABS = new Set<TabKey>(["datasets", "jobs", "models", "config"]);

export function DatasetsTraining() {
  const [searchParams, setSearchParams] = useSearchParams();

  const tabParam = searchParams.get("tab") as TabKey | null;
  const initialTab: TabKey = tabParam && VALID_TABS.has(tabParam) ? tabParam : "datasets";
  const [activeTab, setActiveTab] = useState<TabKey>(initialTab);

  const initialJobId = searchParams.get("job_id");

  const handleTabChange = (label: string) => {
    const next = TAB_LABELS.find((t) => t.label === label)?.key ?? "datasets";
    setActiveTab(next);
    setSearchParams(
      (prev) => {
        const params = new URLSearchParams(prev);
        params.set("tab", next);
        if (next !== "jobs") params.delete("job_id");
        return params;
      },
      { replace: true },
    );
  };

  useEffect(() => {
    if (tabParam && VALID_TABS.has(tabParam) && tabParam !== activeTab) {
      setActiveTab(tabParam);
    }
  }, [tabParam]);

  const handleActiveJobChange = useCallback(
    (jobId: string | null) => {
      setSearchParams(
        (prev) => {
          const params = new URLSearchParams(prev);
          if (jobId) params.set("job_id", jobId);
          else params.delete("job_id");
          return params;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const openJob = useCallback(
    (jobId: string) => {
      setSearchParams(
        (prev) => {
          const params = new URLSearchParams(prev);
          params.set("tab", "jobs");
          params.set("job_id", jobId);
          return params;
        },
        { replace: true },
      );
      setActiveTab("jobs");
    },
    [setSearchParams],
  );

  const activeLabel = TAB_LABELS.find((t) => t.key === activeTab)?.label ?? TAB_LABELS[0].label;

  return (
    <div className="flex flex-col h-full gap-6 pb-6 relative max-h-[100dvh]">
      <SectionHeader
        title="Датасеты и обучение"
        subtitle="Управление датасетами, запуск задач обучения и управление дообученными моделями."
      />

      <Tabs
        tabs={TAB_LABELS.map((t) => t.label)}
        activeTab={activeLabel}
        onChange={handleTabChange}
      />

      <div className="flex-1 min-h-0 overflow-y-auto">
        {activeTab === "datasets" && <DatasetsTab />}
        {activeTab === "jobs" && (
          <JobsTab initialJobId={initialJobId} onActiveJobChange={handleActiveJobChange} />
        )}
        {activeTab === "models" && <ModelsTab onOpenJob={openJob} />}
        {activeTab === "config" && <TrainingConfigTab />}
      </div>
    </div>
  );
}
