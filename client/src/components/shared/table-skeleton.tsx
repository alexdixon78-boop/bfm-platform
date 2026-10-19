import { Skeleton } from "@/components/ui/skeleton";

interface TableSkeletonProps {
  columns: number;
  rows?: number;
}

export function TableSkeleton({ columns, rows = 5 }: TableSkeletonProps) {
  return (
    <div className="w-full">
      <div className="flex gap-4 px-4 py-3 border-b bg-muted/30">
        {Array.from({ length: columns }).map((_, i) => (
          <Skeleton key={`head-${i}`} className="h-4 flex-1 max-w-[120px]" />
        ))}
      </div>
      {Array.from({ length: rows }).map((_, row) => (
        <div key={`row-${row}`} className="flex items-center gap-4 px-4 py-3.5 border-b last:border-b-0">
          {Array.from({ length: columns }).map((_, col) => (
            <Skeleton
              key={`cell-${row}-${col}`}
              className={`h-4 flex-1 ${col === 0 ? "max-w-[100px]" : col === 1 ? "max-w-[160px]" : "max-w-[120px]"}`}
            />
          ))}
        </div>
      ))}
    </div>
  );
}
