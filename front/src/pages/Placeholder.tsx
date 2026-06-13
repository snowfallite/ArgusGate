import { EmptyState } from "@/components/EmptyState";
import { SectionHeader } from "@/components/SectionHeader";
import { Construction } from "lucide-react";

interface PlaceholderProps {
  title: string;
}

export function Placeholder({ title }: PlaceholderProps) {
  return (
    <div className="flex flex-col h-full">
      <SectionHeader title={title} subtitle="Страница находится в разработке." />
      <div className="flex-1 flex items-center justify-center">
        <EmptyState
          icon={Construction}
          title="Скоро будет"
          description="Этот раздел является частью платформы ArgusGate и будет реализован в следующей версии."
        />
      </div>
    </div>
  );
}
