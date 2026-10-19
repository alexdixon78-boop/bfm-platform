import { Lock } from "lucide-react";
import { Badge } from "@/components/ui/badge";

export function ConfidentialBadge({ testId }: { testId?: string }) {
  return (
    <Badge
      variant="outline"
      className="border-red-300 bg-red-50 text-red-700 text-[10px]"
      data-testid={testId}
    >
      <Lock className="w-3 h-3 mr-1" />
      Confidential
    </Badge>
  );
}
