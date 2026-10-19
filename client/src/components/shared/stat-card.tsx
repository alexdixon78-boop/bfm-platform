import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { LucideIcon } from "lucide-react";

interface StatCardProps {
  label: string;
  value: number | string;
  icon: LucideIcon;
  iconColor: string;
  iconBg: string;
  isLoading?: boolean;
  testId?: string;
}

export function StatCard({ label, value, icon: Icon, iconColor, iconBg, isLoading, testId }: StatCardProps) {
  return (
    <Card className="hover-elevate">
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-muted-foreground">{label}</p>
            {isLoading ? (
              <Skeleton className="h-7 w-10 mt-1" />
            ) : (
              <p className="text-2xl font-bold text-foreground mt-0.5" data-testid={testId}>
                {value}
              </p>
            )}
          </div>
          <div className={`w-9 h-9 rounded-lg ${iconBg} flex items-center justify-center`}>
            <Icon className={`w-[18px] h-[18px] ${iconColor}`} />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
