import { ReactNode } from "react";

export const PageHeader = ({ title, description, action }: { title: string; description?: string; action?: ReactNode }) => (
  <header className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 mb-6">
    <div className="min-w-0">
      <h1 className="font-display text-2xl md:text-3xl">{title}</h1>
      {description && <p className="text-muted-foreground mt-1 text-sm">{description}</p>}
    </div>
    {action && <div className="flex w-full sm:w-auto sm:justify-end">{action}</div>}
  </header>
);
