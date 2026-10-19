interface StatusBadgeProps {
  label: string;
  dotColor?: string;
  badgeClass: string;
  testId?: string;
}

export function StatusBadge({ label, dotColor, badgeClass, testId }: StatusBadgeProps) {
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium border ${badgeClass}`} data-testid={testId}>
      {dotColor && <span className={`w-1.5 h-1.5 rounded-full ${dotColor}`} />}
      {label}
    </span>
  );
}

export type StatusStyleMap = Record<string, { dot?: string; badge: string }>;

export const ENQUIRY_STATUS_STYLES: StatusStyleMap = {
  New: { dot: "bg-[#5a7d58]", badge: "bg-[#a7baa4]/15 text-[#5a7d58] border-[#a7baa4]/30" },
  Claimed: { dot: "bg-[#b8825a]", badge: "bg-[#dcae96]/15 text-[#b8825a] border-[#dcae96]/30" },
  Chasing: { dot: "bg-blue-500", badge: "bg-blue-50 text-blue-600 border-blue-200 dark:bg-blue-950 dark:text-blue-400 dark:border-blue-800" },
  Safeguarding: { dot: "bg-red-500", badge: "bg-red-50 text-red-600 border-red-200 dark:bg-red-950 dark:text-red-400 dark:border-red-800" },
  Closed: { dot: "bg-gray-500", badge: "bg-gray-100 text-gray-600 border-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:border-gray-700" },
  Archived: { dot: "bg-gray-400", badge: "bg-gray-50 text-gray-500 border-gray-200 dark:bg-gray-900 dark:text-gray-400 dark:border-gray-700" },
};

export const CASE_STATUS_STYLES: StatusStyleMap = {
  Active: { dot: "bg-[#5a7d58]", badge: "bg-[#a7baa4]/15 text-[#5a7d58] border-[#a7baa4]/30" },
  "On hold": { dot: "bg-[#b8825a]", badge: "bg-[#dcae96]/15 text-[#b8825a] border-[#dcae96]/30" },
  Closed: { dot: "bg-gray-500", badge: "bg-gray-100 text-gray-600 border-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:border-gray-700" },
  Archived: { dot: "bg-gray-400", badge: "bg-gray-50 text-gray-500 border-gray-200 dark:bg-gray-900 dark:text-gray-400 dark:border-gray-700" },
};

export const CASE_STAGE_STYLES: StatusStyleMap = {
  "Enquiry": { badge: "bg-blue-50 text-blue-600 border-blue-200 dark:bg-blue-950 dark:text-blue-400 dark:border-blue-800" },
  "MIAM": { badge: "bg-violet-50 text-violet-600 border-violet-200 dark:bg-violet-950 dark:text-violet-400 dark:border-violet-800" },
  "Mediation": { badge: "bg-[#a7baa4]/15 text-[#5a7d58] border-[#a7baa4]/30" },
  "Outcome": { badge: "bg-[#dcae96]/15 text-[#b8825a] border-[#dcae96]/30" },
};

const DEFAULT_STYLE = { badge: "bg-gray-100 text-gray-500 border-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:border-gray-700" };

export function getStatusStyle(status: string, styleMap: StatusStyleMap) {
  return styleMap[status] || DEFAULT_STYLE;
}
