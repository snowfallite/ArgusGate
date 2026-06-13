import { cn } from "@/lib/utils";

interface TabsProps {
  tabs: string[];
  activeTab: string;
  onChange: (tab: string) => void;
  className?: string;
}

export function Tabs({ tabs, activeTab, onChange, className }: TabsProps) {
  return (
    <div className={cn("flex items-center gap-6 border-b border-border-subtle", className)}>
      {tabs.map((tab) => (
        <button
          key={tab}
          onClick={() => onChange(tab)}
          className={cn(
            "pb-3 text-[14px] font-medium transition-colors relative",
            activeTab === tab
              ? "text-text-primary"
              : "text-text-secondary hover:text-text-primary"
          )}
        >
          {tab}
          {activeTab === tab && (
            <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-accent rounded-t-full" />
          )}
        </button>
      ))}
    </div>
  );
}
