import type { StatusStyleMap } from "./status-badge";

interface PipelinePillsPropsBase {
  statusStyles: StatusStyleMap;
  activeFilter: string | null;
  onFilter: (status: string | null) => void;
  testIdPrefix?: string;
  statuses?: string[];
}

interface PipelinePillsWithItems<T> extends PipelinePillsPropsBase {
  items: T[];
  statusKey: keyof T;
  counts?: never;
}

interface PipelinePillsWithCounts extends PipelinePillsPropsBase {
  counts: Record<string, number>;
  total: number;
  items?: never;
  statusKey?: never;
}

type PipelinePillsProps<T> = PipelinePillsWithItems<T> | PipelinePillsWithCounts;

export function PipelinePills<T>(props: PipelinePillsProps<T>) {
  const { statusStyles, activeFilter, onFilter, testIdPrefix = "pill" } = props;

  let counts: Record<string, number>;
  let totalCount: number;

  if ("counts" in props && props.counts) {
    counts = props.counts;
    totalCount = props.total;
  } else {
    counts = {};
    const items = props.items || [];
    const statusKey = props.statusKey!;
    for (const item of items) {
      const status = String(item[statusKey]);
      counts[status] = (counts[status] || 0) + 1;
    }
    totalCount = items.length;
  }

  const statuses = props.statuses ?? Object.keys(statusStyles);

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <button
        onClick={() => onFilter(null)}
        className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
          activeFilter === null
            ? "bg-foreground text-background border-foreground"
            : "bg-muted/50 text-muted-foreground border-border hover:bg-muted"
        }`}
        data-testid={`${testIdPrefix}-all`}
      >
        All
        <span className="font-semibold">{totalCount}</span>
      </button>
      {statuses.map(status => {
        const style = statusStyles[status];
        const count = counts[status] || 0;
        const isActive = activeFilter === status;
        return (
          <button
            key={status}
            onClick={() => onFilter(isActive ? null : status)}
            className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
              isActive
                ? style.badge + " ring-1 ring-current/20"
                : "bg-muted/50 text-muted-foreground border-border hover:bg-muted"
            }`}
            data-testid={`${testIdPrefix}-${status.toLowerCase().replace(/\s/g, "-")}`}
          >
            {style.dot && <span className={`w-1.5 h-1.5 rounded-full ${style.dot}`} />}
            {status}
            <span className="font-semibold">{count}</span>
          </button>
        );
      })}
    </div>
  );
}
