import { useEffect, useRef } from "react";
import { useToast } from "@/hooks/use-toast";
import {
  calendarOAuthResultMessage,
  parseCalendarOAuthResult,
  stripCalendarOAuthResultParams,
  type CalendarOAuthResult,
} from "@/lib/calendar-oauth-result";

export function useCalendarOAuthResult(options?: {
  onConnected?: (result: CalendarOAuthResult) => void;
}) {
  const { toast } = useToast();
  const handledUrlRef = useRef<string | null>(null);
  const onConnected = options?.onConnected;

  useEffect(() => {
    const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    if (handledUrlRef.current === current) return;
    const result = parseCalendarOAuthResult(window.location.search);
    if (!result) return;
    handledUrlRef.current = current;
    toast(calendarOAuthResultMessage(result));
    if (result.connected) onConnected?.(result);
    window.history.replaceState({}, "", stripCalendarOAuthResultParams(current));
  }, [onConnected, toast]);
}
