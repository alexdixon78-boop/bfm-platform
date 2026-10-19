import { TableHead } from "@/components/ui/table";
import { ArrowUp, ArrowDown, ArrowUpDown } from "lucide-react";

export type SortDirection = "asc" | "desc" | null;

interface SortableTableHeadProps {
  label: string;
  sortKey: string;
  currentSortBy: string | null;
  currentSortOrder: SortDirection;
  onSort: (key: string) => void;
  className?: string;
  testId?: string;
}

export function SortableTableHead({
  label, sortKey, currentSortBy, currentSortOrder, onSort, className, testId,
}: SortableTableHeadProps) {
  const isActive = currentSortBy === sortKey;

  return (
    <TableHead
      className={`cursor-pointer select-none hover:bg-muted/50 transition-colors ${className || ""}`}
      onClick={() => onSort(sortKey)}
      data-testid={testId}
    >
      <div className="flex items-center gap-1.5">
        <span>{label}</span>
        {isActive && currentSortOrder === "asc" ? (
          <ArrowUp className="w-3.5 h-3.5 text-foreground" />
        ) : isActive && currentSortOrder === "desc" ? (
          <ArrowDown className="w-3.5 h-3.5 text-foreground" />
        ) : (
          <ArrowUpDown className="w-3.5 h-3.5 text-muted-foreground/50" />
        )}
      </div>
    </TableHead>
  );
}
