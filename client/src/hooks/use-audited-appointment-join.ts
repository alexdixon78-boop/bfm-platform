import { useState } from "react";

import { openAuditedAppointmentJoin } from "@/lib/appointment-join";
import { useToast } from "@/hooks/use-toast";

export function useAuditedAppointmentJoin() {
  const { toast } = useToast();
  const [joiningAppointmentId, setJoiningAppointmentId] = useState<string | null>(null);
  const [fallbackMeetingLink, setFallbackMeetingLink] = useState<string | null>(null);

  const joinAppointment = async (appointmentId: string) => {
    setJoiningAppointmentId(appointmentId);
    try {
      const result = await openAuditedAppointmentJoin(appointmentId);
      if (!result.opened) {
        setFallbackMeetingLink(result.meetingLink);
      }
    } catch (err) {
      toast({
        title: "Join link unavailable",
        description: err instanceof Error ? err.message : "Could not open the join link",
        variant: "destructive",
      });
    } finally {
      setJoiningAppointmentId(null);
    }
  };

  return {
    fallbackMeetingLink,
    joiningAppointmentId,
    joinAppointment,
    clearFallbackMeetingLink: () => setFallbackMeetingLink(null),
  };
}
