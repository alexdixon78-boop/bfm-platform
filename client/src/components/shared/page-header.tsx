import type { LucideIcon } from "lucide-react";

interface PageHeaderProps {
  title: string;
  subtitle: string;
  icon: LucideIcon;
  iconColor: string;
  iconBg: string;
  titleTestId?: string;
  action?: React.ReactNode;
}

export function PageHeader({ title, subtitle, icon: Icon, iconColor, iconBg, titleTestId, action }: PageHeaderProps) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-3">
        <div className={`w-10 h-10 rounded-lg ${iconBg} flex items-center justify-center`}>
          <Icon className={`w-5 h-5 ${iconColor}`} />
        </div>
        <div>
          <h1 className="text-2xl font-heading font-semibold text-foreground" data-testid={titleTestId}>{title}</h1>
          <p className="text-muted-foreground text-sm mt-0.5">{subtitle}</p>
        </div>
      </div>
      {action}
    </div>
  );
}
