import type { ReactNode } from "react";

interface PageHeaderProps {
  title: string;
  actions?: ReactNode;
  eyebrow?: string;
  actionsTopRight?: boolean;
  footer?: ReactNode;
}

export function PageHeader({ title, actions, eyebrow = "Operations Hub", actionsTopRight = false, footer }: PageHeaderProps) {
  if (actionsTopRight) {
    return (
      <header className="page-header">
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-2">
          <div className="min-w-0">
            <span className="page-eyebrow">{eyebrow}</span>
            <h1 className="page-title mt-3">{title}</h1>
          </div>
          {actions && <div className="text-right [&>div]:text-right">{actions}</div>}
        </div>
        {footer && <div className="mt-3">{footer}</div>}
      </header>
    );
  }
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
