import React from "react";
import { cn } from "@/lib/utils";

interface MetricCardProps {
  title: string;
  value: string | number;
  caption?: string;
  captionColor?: "success" | "warning" | "critical" | "info" | "default";
  children?: React.ReactNode;
  className?: string;
}

export function MetricCard({
  title,
  value,
  caption,
  captionColor = "default",
  children,
  className,
}: MetricCardProps) {
  const colorMap = {
    success: "text-status-success",
    warning: "text-status-warning",
    critical: "text-status-critical",
    info: "text-status-info",
    default: "text-text-secondary",
  };

  return (
    <div className={cn("content-card flex flex-col justify-between", className)}>
      <h3 className="text-label uppercase tracking-wider mb-2">{title}</h3>
      <div className="flex flex-col gap-2">
        <div className="text-title-display">{value}</div>
        {children}
        {caption && (
          <div className={cn("text-label", colorMap[captionColor])}>
            {caption}
          </div>
        )}
      </div>
    </div>
  );
}
