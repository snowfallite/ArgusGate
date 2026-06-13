import { cn } from "@/lib/utils";

import React from "react";
interface SectionHeaderProps {
  title: string;
  subtitle?: string;
  children?: React.ReactNode;
  className?: string;
}

export function SectionHeader({ title, subtitle, children, className }: SectionHeaderProps) {
  return (
    <div className={cn("flex flex-col sm:flex-row sm:items-center justify-between gap-4", className)}>
      <div>
        <h1 className="text-title-h1 mb-1">{title}</h1>
        {subtitle && <p className="text-body text-text-secondary">{subtitle}</p>}
      </div>
      {children && <div className="flex items-center gap-3">{children}</div>}
    </div>
  );
}
