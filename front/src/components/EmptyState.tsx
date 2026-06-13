import { cn } from "@/lib/utils";
import React from "react";
import { type LucideIcon } from "lucide-react";

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: React.ReactNode;
  className?: string;
}

export function EmptyState({ icon: Icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div className={cn("flex flex-col items-center justify-center p-12 text-center rounded-2xl border border-dashed border-border-default", className)}>
      <div className="w-12 h-12 flex items-center justify-center rounded-full bg-surface-2 text-text-tertiary mb-4">
        <Icon className="w-6 h-6" />
      </div>
      <h3 className="text-title-h3 mb-2">{title}</h3>
      <p className="text-body text-text-secondary max-w-sm mb-6">{description}</p>
      {action}
    </div>
  );
}
