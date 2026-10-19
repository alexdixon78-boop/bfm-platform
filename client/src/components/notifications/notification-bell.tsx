import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Bell, Check, ExternalLink, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import type { Notification } from "@shared/schema";

type BellNotification = Notification & {
  readAt: string | Date | null;
  actionHref?: string;
  actionLabel?: string;
};

type BellPayload = {
  items: BellNotification[];
  unreadCount: number;
};

type NotificationSocketMessage = {
  type?: string;
  notification?: Partial<Notification>;
};

const URGENCY_CARD_STYLES: Record<string, string> = {
  red: "border-red-200 border-l-4 border-l-red-500 bg-red-50/85 dark:border-red-900 dark:border-l-red-500 dark:bg-red-950/20",
  amber: "border-amber-200 border-l-4 border-l-amber-500 bg-amber-50/85 dark:border-amber-900 dark:border-l-amber-500 dark:bg-amber-950/20",
  green: "border-green-200 border-l-4 border-l-green-500 bg-green-50/85 dark:border-green-900 dark:border-l-green-500 dark:bg-green-950/20",
};

function formatTimeAgo(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  const diffMins = Math.max(0, Math.floor((Date.now() - date.getTime()) / 60000));
  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  return `${Math.floor(diffHours / 24)}d ago`;
}

function notificationHref(item: BellNotification): string {
  if (item.caseId && item.appointmentId) return `/cases/${item.caseId}?tab=appointments`;
  if (item.caseId) return `/cases/${item.caseId}`;
  if (item.appointmentId) return "/appointments";
  return "/tasks";
}

export function NotificationBell() {
  const [socketConnected, setSocketConnected] = useState(false);

  const { data, isLoading } = useQuery<BellPayload>({
    queryKey: ["/api/notifications/bell"],
    staleTime: 0,
    refetchInterval: socketConnected ? false : 30000,
  });

  useEffect(() => {
    let closed = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let socket: WebSocket | null = null;

    const connect = () => {
      const protocol = window.location.protocol === "https:" ? "wss" : "ws";
      socket = new WebSocket(`${protocol}://${window.location.host}/api/notifications/ws`);

      socket.addEventListener("open", () => {
        if (closed) return;
        setSocketConnected(true);
        queryClient.invalidateQueries({ queryKey: ["/api/notifications/bell"] });
      });

      socket.addEventListener("message", (event) => {
        queryClient.invalidateQueries({ queryKey: ["/api/notifications/bell"] });
        queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
        queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
        queryClient.invalidateQueries({ queryKey: ["/api/tasks/counts"] });

        try {
          const message = JSON.parse(event.data) as NotificationSocketMessage;
          if (message.type === "permissions_updated") {
            queryClient.invalidateQueries({ queryKey: ["/api/permissions"] });
          }
          const notification = message.notification;
          if (notification?.appointmentId || notification?.caseId) {
            queryClient.invalidateQueries({ queryKey: ["/api/appointments"] });
            queryClient.invalidateQueries({ queryKey: ["/api/appointments/case"] });
            if (notification.caseId) {
              queryClient.invalidateQueries({ queryKey: ["/api/cases", notification.caseId] });
            }
          }
        } catch {
          // Ignore malformed socket payloads; the notification inbox still refreshes above.
        }
      });

      socket.addEventListener("close", () => {
        if (closed) return;
        setSocketConnected(false);
        reconnectTimer = setTimeout(connect, 5000);
      });

      socket.addEventListener("error", () => {
        setSocketConnected(false);
      });
    };

    connect();

    return () => {
      closed = true;
      setSocketConnected(false);
      if (reconnectTimer) clearTimeout(reconnectTimer);
      socket?.close();
    };
  }, []);

  const markReadMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("POST", `/api/notifications/${id}/read`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/notifications/bell"] });
    },
  });

  const markAllReadMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/notifications/read-all");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/notifications/bell"] });
    },
  });

  const items = data?.items ?? [];
  const unreadCount = data?.unreadCount ?? 0;
  const badgeLabel = useMemo(() => (unreadCount > 99 ? "99+" : String(unreadCount)), [unreadCount]);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          size="icon"
          variant="ghost"
          className="relative"
          aria-label={unreadCount > 0 ? `${unreadCount} unread notifications` : "Notifications"}
          data-testid="button-notification-bell"
        >
          <Bell className="w-4 h-4" />
          {unreadCount > 0 && (
            <span
              className="absolute -right-1 -top-1 min-w-5 h-5 px-1 rounded-full bg-red-600 text-white text-[10px] font-semibold leading-5 text-center"
              data-testid="badge-notification-unread-count"
            >
              {badgeLabel}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(22rem,calc(100vw-2rem))] p-0" data-testid="notification-bell-popover">
        <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
          <div>
            <h2 className="font-heading text-sm font-semibold">Notifications</h2>
            <p className="text-xs text-muted-foreground">{unreadCount} unread</p>
          </div>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-8 px-2 text-xs"
            disabled={unreadCount === 0 || markAllReadMutation.isPending}
            onClick={() => markAllReadMutation.mutate()}
            data-testid="button-notifications-mark-all-read"
          >
            {markAllReadMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
            <span className="ml-1">Mark all read</span>
          </Button>
        </div>

        <div className="max-h-96 overflow-y-auto">
          {isLoading ? (
            <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Loading notifications
            </div>
          ) : items.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-muted-foreground" data-testid="notification-bell-empty">
              No active notifications
            </div>
          ) : (
            <ul className="space-y-2 p-3">
              {items.map((item) => {
                const isUnread = !item.readAt;
                const href = item.actionHref || notificationHref(item);
                return (
                  <li
                    key={item.id}
                    className={cn(
                      "rounded-md border px-3 py-3",
                      URGENCY_CARD_STYLES[item.urgency] || "border-muted bg-muted/40 border-l-4 border-l-muted-foreground/40",
                    )}
                    data-testid="notification-bell-item"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          {isUnread && <span className="h-2 w-2 rounded-full bg-red-600" aria-hidden="true" />}
                          <p className={cn("truncate text-sm", isUnread ? "font-semibold" : "font-medium")}>{item.title}</p>
                        </div>
                        <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{item.message}</p>
                        <div className="mt-2 flex flex-wrap items-center gap-3">
                          <span className="text-[11px] text-muted-foreground">{formatTimeAgo(item.createdAt)}</span>
                          <Link href={href} className="inline-flex items-center gap-1 text-[11px] font-medium text-[#5a7d58] hover:underline">
                            {item.actionLabel || "Open"} <ExternalLink className="h-3 w-3" />
                          </Link>
                        </div>
                      </div>
                      {isUnread && (
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7 shrink-0"
                          aria-label="Mark notification read"
                          disabled={markReadMutation.isPending}
                          onClick={() => markReadMutation.mutate(item.id)}
                          data-testid="button-notification-mark-read"
                        >
                          <Check className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        <div className="border-t p-2 text-center"><Link href="/notifications" className="text-sm font-medium text-[#5a7d58] hover:underline">View all</Link></div>
      </PopoverContent>
    </Popover>
  );
}
