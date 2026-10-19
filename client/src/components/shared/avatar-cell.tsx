interface AvatarCellProps {
  name: string;
  bgClass?: string;
  textClass?: string;
  testId?: string;
}

function getInitials(name: string) {
  return name.split(" ").map(n => n[0]).join("").toUpperCase().slice(0, 2);
}

export function AvatarCell({ name, bgClass = "bg-gray-100 dark:bg-gray-800", textClass = "text-gray-600 dark:text-gray-300", testId }: AvatarCellProps) {
  return (
    <div className="flex items-center gap-3" data-testid={testId}>
      <div className={`w-9 h-9 rounded-full ${bgClass} flex items-center justify-center flex-shrink-0`}>
        <span className={`text-xs font-semibold ${textClass}`}>{getInitials(name)}</span>
      </div>
      <span className="font-medium">{name}</span>
    </div>
  );
}
