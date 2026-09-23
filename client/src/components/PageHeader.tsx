import type { ReactNode } from "react";

interface PageHeaderProps {
  title: string;
  actions?: ReactNode;
  eyebrow?: string;
}

export function PageHeader({ title, actions, eyebrow = "Operations Hub" }: PageHeaderProps) {
  return (
    <header className="page-header">
      <span className="page-eyebrow">{eyebrow}</span>
      <div className="page-header-row">
        <div className="min-w-0">
          <h1 className="page-title">{title}</h1>
        </div>
        {actions && <div className="page-actions">{actions}</div>}
      </div>
    </header>
  );
}
