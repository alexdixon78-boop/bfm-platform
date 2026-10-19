import { useState } from "react";
import { useRoute } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { BFMLogoMark } from "@/components/bfm-logo";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { AlertCircle, CalendarClock, CheckCircle2, ChevronLeft, ChevronRight, Loader2, XCircle } from "lucide-react";
import { formatUkWallClockDateTime } from "@/lib/date-time";

type ProposalResponse = {
  caseRef: string;
  sessionNumber: number;
  leadMediatorName: string | null;
  proposal: {
    id: string;
    proposedStartAt: string | Date;
    proposedEndAt: string | Date;
    expiresAt: string | Date;
    status: string;
  };
  recipient: {
    id: string;
    recipientName: string;
    recipientType: string;
    participantRole?: string | null;
    responseStatus: string;
    declineNotes?: string | null;
  };
  linkStatus?: {
    active: boolean;
    reason?: string;
    message?: string;
  };
};

type ProposalSubmitResponse = {
  recipient: ProposalResponse["recipient"];
  autoConfirmation?: { confirmed: boolean; reason?: string };
  paymentRequired?: boolean;
  invoiceId?: string;
  invoiceNumber?: string;
  outstandingPence?: number;
  currency?: string;
  checkoutUrl?: string;
  xeroInvoiceUrl?: string;
  xeroInvoiceNumber?: string;
  paymentReference?: string;
  bankTransfer?: {
    accountName: string;
    sortCode: string;
    accountNumber: string;
    iban?: string;
    swift?: string;
    instructions?: string;
  };
  paymentProvider?: string;
  paymentError?: string;
};

type SessionCalendarSlot = {
  startAt: string | Date;
  endAt: string | Date;
  time: string;
  endTime: string;
  duration: number;
};

function formatDateKeyUtc(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

function formatMonthKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function proposalDurationMinutes(proposal?: ProposalResponse["proposal"]): number {
  if (!proposal) return 120;
  const duration = Math.round((new Date(proposal.proposedEndAt).getTime() - new Date(proposal.proposedStartAt).getTime()) / 60000);
  return Number.isFinite(duration) && duration > 0 ? duration : 120;
}

const PUBLIC_CALENDAR_DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const PUBLIC_CALENDAR_MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const SESSION_PAYMENT_SUCCESS_QUERY = "payment=success";
const SESSION_PAYMENT_CANCELLED_QUERY = "payment=cancelled";

function PublicAvailabilityCalendar({
  selectedDate,
  availableDates,
  isLoadingDates,
  onDateSelect,
  onMonthChange,
}: {
  selectedDate: Date | null;
  availableDates?: Set<string>;
  isLoadingDates?: boolean;
  onDateSelect: (date: Date) => void;
  onMonthChange: (month: string) => void;
}) {
  const [viewMonth, setViewMonth] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const now = new Date();
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const year = viewMonth.getFullYear();
  const month = viewMonth.getMonth();
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: Array<number | null> = [];
  for (let i = 0; i < firstDay; i++) cells.push(null);
  for (let day = 1; day <= daysInMonth; day++) cells.push(day);

  const changeMonth = (next: Date) => {
    setViewMonth(next);
    onMonthChange(formatMonthKey(next));
  };

  return (
    <div className="rounded-md border border-stone-200 bg-white p-3" data-testid="session-public-availability-calendar">
      <div className="flex items-center justify-between mb-3">
        <Button type="button" variant="ghost" size="icon" className="h-8 w-8" onClick={() => changeMonth(new Date(year, month - 1, 1))}>
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <span className="text-sm font-medium text-stone-900">{PUBLIC_CALENDAR_MONTHS[month]} {year}</span>
        <Button type="button" variant="ghost" size="icon" className="h-8 w-8" onClick={() => changeMonth(new Date(year, month + 1, 1))}>
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
      <div className="grid grid-cols-7 gap-1 min-h-[286px] content-start">
        {PUBLIC_CALENDAR_DAYS.map((day) => <div key={day} className="py-1 text-center text-[11px] text-stone-500">{day}</div>)}
        {isLoadingDates ? (
          <div className="col-span-7 flex min-h-[238px] items-center justify-center" data-testid="session-public-loading-dates">
            <div className="flex items-center gap-2 text-sm text-stone-500">
              <Loader2 className="h-5 w-5 animate-spin text-[#5a7d58]" />
              <span>Loading availability...</span>
            </div>
          </div>
        ) : (
          cells.map((day, index) => {
            if (day === null) return <div key={`blank-${index}`} />;
            const cellDate = new Date(Date.UTC(year, month, day));
            const key = formatDateKeyUtc(cellDate);
            const isPast = cellDate < today;
            const isAvailable = availableDates ? availableDates.has(key) : false;
            const disabled = isPast || !isAvailable;
            const selected = selectedDate ? formatDateKeyUtc(selectedDate) === key : false;
            return (
              <button
                key={key}
                type="button"
                disabled={disabled}
                onClick={() => onDateSelect(cellDate)}
                className={`relative h-9 rounded-md text-sm transition-colors ${disabled ? "text-stone-300 cursor-not-allowed" : "hover:bg-[#a7baa4]/20"} ${selected ? "bg-[#5a7d58] text-white hover:bg-[#5a7d58]" : "text-stone-800"}`}
              >
                {day}
                {isAvailable && !isPast && (
                  <span className={`absolute bottom-0.5 left-1/2 h-1.5 w-1.5 -translate-x-1/2 rounded-full ${selected ? "bg-white" : "bg-[#5a7d58]"}`} />
                )}
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}

export default function SessionAvailabilityPage() {
  const [, params] = useRoute("/session-availability/:token");
  const token = params?.token;
  const [response, setResponse] = useState<"accepted" | "declined" | null>(null);
  const [declineNotes, setDeclineNotes] = useState("");
  const [selectedAlternativeSlots, setSelectedAlternativeSlots] = useState<SessionCalendarSlot[]>([]);
  const [month, setMonth] = useState(() => formatMonthKey(new Date()));
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [xeroPayment, setXeroPayment] = useState<ProposalSubmitResponse | null>(null);
  const [paymentUnavailableMessage, setPaymentUnavailableMessage] = useState<string | null>(null);
  const [autoConfirmation, setAutoConfirmation] = useState<ProposalSubmitResponse["autoConfirmation"] | null>(null);
  const searchParams = new URLSearchParams(window.location.search);
  const paymentReturn = searchParams.get("payment");
  const paymentSuccessValue = SESSION_PAYMENT_SUCCESS_QUERY.split("=")[1];
  const paymentCancelledValue = SESSION_PAYMENT_CANCELLED_QUERY.split("=")[1];
  const returnInvoiceId = searchParams.get("invoiceId")?.trim() || "";
  const returnSessionId = searchParams.get("session_id")?.trim().replace(/\?+$/, "") || "";

  const proposalQuery = useQuery<ProposalResponse>({
    queryKey: ["/api/session-availability", token],
    queryFn: async () => {
      const res = await fetch(`/api/session-availability/${token}`, { cache: "no-store" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.message || "Could not load this session availability link");
      return body;
    },
    enabled: !!token,
    retry: false,
  });
  const duration = proposalDurationMinutes(proposalQuery.data?.proposal);
  const isParticipantInvite = proposalQuery.data?.recipient.recipientType === "mediator_participant";
  const linkInactive = !!proposalQuery.data?.linkStatus && !proposalQuery.data.linkStatus.active;
  const dateKey = selectedDate ? formatDateKeyUtc(selectedDate) : "";

  const availableDatesQuery = useQuery<{ dates: string[]; bookingPaused: boolean; message?: string }>({
    queryKey: ["/api/session-availability", token, "available-dates", { month, duration }],
    queryFn: async () => {
      const res = await fetch(`/api/session-availability/${token}/available-dates?month=${month}&duration=${duration}`, { cache: "no-store" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.message || "Could not load mediator availability");
      return body;
    },
    enabled: !!token && !!proposalQuery.data && !linkInactive && response === "declined" && !isParticipantInvite,
    retry: false,
  });

  const availableSlotsQuery = useQuery<{ slots: SessionCalendarSlot[]; message?: string }>({
    queryKey: ["/api/session-availability", token, "available-slots", { date: dateKey, duration }],
    queryFn: async () => {
      const res = await fetch(`/api/session-availability/${token}/available-slots?date=${dateKey}&duration=${duration}`, { cache: "no-store" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.message || "Could not load mediator slots");
      return body;
    },
    enabled: !!token && !!proposalQuery.data && !linkInactive && response === "declined" && !isParticipantInvite && !!dateKey,
    retry: false,
  });

  const paymentStatusQuery = useQuery<{ invoiceId: string; reconciliationAction: string }>({
    queryKey: ["/api/session-availability", token, "payment-status", { invoiceId: returnInvoiceId, sessionId: returnSessionId }],
    queryFn: async () => {
      const res = await fetch(`/api/session-availability/${token}/payment-status?invoiceId=${encodeURIComponent(returnInvoiceId)}&session_id=${encodeURIComponent(returnSessionId)}`, { cache: "no-store" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.message || "Could not check payment status");
      return body;
    },
    enabled: !!token && paymentReturn === paymentSuccessValue && !!returnInvoiceId && !!returnSessionId,
    retry: false,
  });

  const submitProposalResponse = async (nextResponse: "accepted" | "declined") => {
    const payload = {
      response: nextResponse,
      declineNotes: nextResponse === "declined" ? declineNotes || null : null,
      windows: nextResponse === "declined" ? selectedAlternativeSlots.map((slot) => ({
        startAt: new Date(slot.startAt).toISOString(),
        endAt: new Date(slot.endAt).toISOString(),
        notes: declineNotes || null,
      })) : [],
    };
    const res = await fetch(`/api/session-availability/${token}/respond`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.message || "Could not record your response");
    return body as ProposalSubmitResponse;
  };

  const respondMutation = useMutation({
    mutationFn: async () => {
      if (!response) throw new Error("Choose a response before submitting.");
      return submitProposalResponse(response);
    },
    onSuccess: (data) => {
      setAutoConfirmation(data.autoConfirmation || null);
      if (data.paymentProvider === "xero_invoice" && data.xeroInvoiceUrl) {
        setXeroPayment(data);
        proposalQuery.refetch();
        return;
      }
      const paymentUrl = data.checkoutUrl;
      if (paymentUrl) {
        window.location.assign(paymentUrl);
        return;
      }
      if (data.paymentRequired && data.paymentError) {
        setPaymentUnavailableMessage(data.paymentError);
      }
      proposalQuery.refetch();
    },
  });

  const retryPaymentMutation = useMutation({
    mutationFn: async () => submitProposalResponse("accepted"),
    onSuccess: (data) => {
      setAutoConfirmation(data.autoConfirmation || null);
      if (data.paymentProvider === "xero_invoice" && data.xeroInvoiceUrl) {
        setXeroPayment(data);
        proposalQuery.refetch();
        return;
      }
      const paymentUrl = data.checkoutUrl;
      if (paymentUrl) {
        window.location.assign(paymentUrl);
        return;
      }
      if (data.paymentRequired && data.paymentError) {
        setPaymentUnavailableMessage(data.paymentError);
      }
      proposalQuery.refetch();
    },
  });

  const sessionBankTransferInFlightMutation = useMutation({
    mutationFn: async () => {
      if (!xeroPayment?.invoiceId) return;
      const res = await fetch(`/api/session-availability/${token}/invoices/${xeroPayment.invoiceId}/bank-transfer-in-flight`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || "Could not record bank-transfer status");
      }
    },
  });

  const submitted = ["accepted", "declined"].includes(proposalQuery.data?.recipient.responseStatus || "");
  const canSubmit = response === "accepted" || (response === "declined" && (isParticipantInvite || selectedAlternativeSlots.length > 0));
  const availableDates = availableDatesQuery.data?.dates ? new Set(availableDatesQuery.data.dates) : undefined;
  const selectedSlotKeys = new Set(selectedAlternativeSlots.map((slot) => new Date(slot.startAt).toISOString()));
  const paymentStillPending = paymentStatusQuery.data?.reconciliationAction === "session_not_paid";
  const autoConfirmed = autoConfirmation?.confirmed
    || paymentStatusQuery.data?.reconciliationAction === "mediation_session_auto_confirmed";

  const toggleAlternativeSlot = (slot: SessionCalendarSlot) => {
    const key = new Date(slot.startAt).toISOString();
    setSelectedAlternativeSlots((prev) => {
      if (prev.some((item) => new Date(item.startAt).toISOString() === key)) {
        return prev.filter((item) => new Date(item.startAt).toISOString() !== key);
      }
      return [...prev, slot].sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime());
    });
  };

  return (
    <div className="min-h-screen bg-[#f9f6f2] px-4 py-8">
      <div className="mx-auto w-full max-w-2xl">
        <div className="flex justify-center mb-8">
          <BFMLogoMark className="h-14 w-auto" />
        </div>

        <div className="rounded-lg border border-stone-200 bg-white shadow-sm overflow-hidden">
          <div className="bg-[#5a7d58] px-6 py-6 text-white">
            <h1 className="text-xl font-semibold">Session availability</h1>
            <p className="text-sm text-white/80 mt-1">Brighter Future Mediation</p>
          </div>

          {proposalQuery.isLoading && (
            <div className="p-8 flex items-center justify-center gap-3 text-stone-600">
              <Loader2 className="h-5 w-5 animate-spin" />
              Checking your link...
            </div>
          )}

          {proposalQuery.error && (
            <div className="p-8 text-center space-y-3">
              <XCircle className="h-10 w-10 mx-auto text-red-600" />
              <h2 className="font-semibold text-stone-800">Link unavailable</h2>
              <p className="text-sm text-stone-600">{proposalQuery.error.message}</p>
            </div>
          )}

          {proposalQuery.data && (
            <div className="p-6 space-y-6">
              {paymentReturn === paymentSuccessValue && (
                <div className="rounded-md border border-[#5a7d58]/30 bg-[#5a7d58]/10 p-4 flex gap-3" data-testid="session-payment-success">
                  <CheckCircle2 className="h-5 w-5 text-[#5a7d58] mt-0.5 shrink-0" />
                  <div>
                    <p className="text-sm font-medium text-stone-900">Payment processing</p>
                    <p className="text-sm text-stone-600">
                      {paymentStatusQuery.data?.reconciliationAction === "mediation_session_invoice_paid"
                        ? "Thank you. Your payment has been recorded and your session response is saved."
                        : paymentStatusQuery.data?.reconciliationAction === "mediation_session_auto_confirmed"
                          ? "Your mediation session is confirmed. Calendar invitations will be sent."
                          : paymentStatusQuery.data?.reconciliationAction === "mediation_session_ready_but_calendar_failed"
                            ? "Your payment has been recorded. Brighter Future Mediation will review the calendar booking."
                        : paymentStillPending
                          ? "Your session response is recorded, but Stripe has not confirmed payment yet."
                          : "Thank you. Your payment is being confirmed and your session response has been recorded."}
                    </p>
                    {paymentStillPending && (
                      <Button
                        type="button"
                        size="sm"
                        className="mt-3 bg-[#5a7d58] hover:bg-[#4a6c49] text-white"
                        onClick={() => retryPaymentMutation.mutate()}
                        disabled={retryPaymentMutation.isPending}
                        data-testid="button-session-payment-retry"
                      >
                        {retryPaymentMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                        Try payment again
                      </Button>
                    )}
                  </div>
                </div>
              )}
              {paymentReturn === paymentCancelledValue && (
                <div className="rounded-md border border-amber-200 bg-amber-50 p-4 flex gap-3" data-testid="session-payment-cancelled">
                  <AlertCircle className="h-5 w-5 text-amber-700 mt-0.5 shrink-0" />
                  <div>
                    <p className="text-sm font-medium text-stone-900">Payment cancelled</p>
                    <p className="text-sm text-amber-800">Your session response is recorded, but payment is still due before the session can be confirmed.</p>
                  </div>
                </div>
              )}
              {paymentUnavailableMessage && (
                <div className="rounded-md border border-amber-200 bg-amber-50 p-4 flex gap-3" data-testid="payment-unavailable">
                  <AlertCircle className="h-5 w-5 text-amber-700 mt-0.5 shrink-0" />
                  <div>
                    <p className="text-sm font-medium text-stone-900">Payment link unavailable</p>
                    <p className="text-sm text-amber-800">Your response was recorded, but we could not prepare the payment link. Please contact Brighter Future Mediation.</p>
                    <p className="text-xs text-amber-700 mt-1">{paymentUnavailableMessage}</p>
                  </div>
                </div>
              )}
              {xeroPayment?.xeroInvoiceUrl && (
                <div className="rounded-md border border-[#5a7d58]/30 bg-[#5a7d58]/10 p-4 space-y-3" data-testid="session-xero-invoice-payment-panel">
                  <div>
                    <p className="text-sm font-medium text-stone-900">Invoice payment required</p>
                    <p className="text-sm text-stone-600">Pay through the Xero invoice page or use bank transfer with the exact invoice number as your reference.</p>
                    <p className="text-xs text-stone-600 mt-1">Card payment is available only if enabled on the Xero invoice page. Bank transfer can be made using the details below.</p>
                  </div>
                  <Button
                    className="bg-[#5a7d58] hover:bg-[#4a6c49] text-white"
                    onClick={() => window.open(xeroPayment.xeroInvoiceUrl, "_blank", "noopener,noreferrer")}
                    data-testid="button-session-pay-xero-invoice"
                  >
                    Pay invoice now
                  </Button>
                  {(xeroPayment.xeroInvoiceNumber || xeroPayment.paymentReference) && (
                    <div className="rounded-md bg-white/70 p-3 text-sm">
                      <p className="text-xs text-stone-500">Payment reference</p>
                      <div className="flex items-center justify-between gap-2">
                        <strong>{xeroPayment.paymentReference || xeroPayment.xeroInvoiceNumber}</strong>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => navigator.clipboard?.writeText(xeroPayment.paymentReference || xeroPayment.xeroInvoiceNumber || "")}
                        >
                          Copy reference
                        </Button>
                      </div>
                      <p className="mt-2 text-xs text-stone-600">Use the payment reference shown here when paying by bank transfer.</p>
                    </div>
                  )}
                  {xeroPayment.bankTransfer && (
                    <div className="rounded-md bg-white/70 p-3 text-xs space-y-1">
                      <p className="font-medium">Bank transfer is preferred</p>
                      {xeroPayment.bankTransfer.accountName && <p>Account name: {xeroPayment.bankTransfer.accountName}</p>}
                      {xeroPayment.bankTransfer.sortCode && <p>Sort code: {xeroPayment.bankTransfer.sortCode}</p>}
                      {xeroPayment.bankTransfer.accountNumber && <p>Account number: {xeroPayment.bankTransfer.accountNumber}</p>}
                      {xeroPayment.bankTransfer.iban && <p>IBAN: {xeroPayment.bankTransfer.iban}</p>}
                      {xeroPayment.bankTransfer.swift && <p>SWIFT/BIC: {xeroPayment.bankTransfer.swift}</p>}
                      <p className="text-stone-600">{xeroPayment.bankTransfer.instructions}</p>
                    </div>
                  )}
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => sessionBankTransferInFlightMutation.mutate()}
                    disabled={sessionBankTransferInFlightMutation.isPending}
                    data-testid="button-session-bank-transfer-in-flight"
                  >
                    I've paid by bank transfer
                  </Button>
                  <p className="text-xs text-stone-600">This alerts our team but does not confirm the session until the payment is reconciled. We will confirm automatically once Xero reports the invoice as paid or staff verify the transfer.</p>
                </div>
              )}
              <div className="space-y-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge variant="outline">{proposalQuery.data.caseRef}</Badge>
                  <Badge variant="outline">Session {proposalQuery.data.sessionNumber}</Badge>
                </div>
                <h2 className="text-lg font-semibold text-stone-900">Hello {proposalQuery.data.recipient.recipientName}</h2>
                <p className="text-sm font-medium text-stone-800">This invitation is for {proposalQuery.data.recipient.recipientName}.</p>
                <p className="text-sm text-stone-600">
                  {isParticipantInvite
                    ? `Please accept or decline your ${(proposalQuery.data.recipient.participantRole || "participant").replace(/_/g, "-")} invitation.`
                    : "Please confirm whether you can attend the proposed mediation session time."}
                </p>
              </div>

              <div className="rounded-md border bg-stone-50 p-4 flex gap-3">
                <CalendarClock className="h-5 w-5 text-[#5a7d58] mt-0.5 shrink-0" />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-stone-900">{formatUkWallClockDateTime(proposalQuery.data.proposal.proposedStartAt, { dateStyle: "full", timeStyle: "short" })}</p>
                  <p className="text-xs text-stone-500">Hold expires {formatUkWallClockDateTime(proposalQuery.data.proposal.expiresAt, { dateStyle: "full", timeStyle: "short" })}</p>
                </div>
              </div>

              {linkInactive ? (
                <div className="rounded-md border border-amber-200 bg-amber-50 p-4 flex gap-3" data-testid="session-link-inactive">
                  <AlertCircle className="h-5 w-5 text-amber-700 mt-0.5 shrink-0" />
                  <div>
                    <p className="text-sm font-medium text-stone-900">Link no longer active</p>
                    <p className="text-sm text-amber-800">{proposalQuery.data.linkStatus?.message || "This session invitation is no longer active."}</p>
                  </div>
                </div>
              ) : submitted && autoConfirmed ? (
                <div className="rounded-md border border-[#5a7d58]/30 bg-[#5a7d58]/10 p-4 flex gap-3" data-testid="session-auto-confirmed">
                  <CheckCircle2 className="h-5 w-5 text-[#5a7d58] mt-0.5 shrink-0" />
                  <div>
                    <p className="text-sm font-medium text-stone-900">Your mediation session is confirmed. Calendar invitations will be sent.</p>
                  </div>
                </div>
              ) : submitted ? (
                <div className="rounded-md border border-[#5a7d58]/30 bg-[#5a7d58]/10 p-4 flex gap-3">
                  <CheckCircle2 className="h-5 w-5 text-[#5a7d58] mt-0.5 shrink-0" />
                  <div>
                    <p className="text-sm font-medium text-stone-900">Response recorded</p>
                    <p className="text-sm text-stone-600 capitalize">Status: {proposalQuery.data.recipient.responseStatus}</p>
                  </div>
                </div>
              ) : (
                <div className="space-y-5">
                  {isParticipantInvite ? (
                    <div className="space-y-4">
                      <div className="grid gap-3 sm:grid-cols-2">
                        <Button variant={response === "accepted" ? "default" : "outline"} className={response === "accepted" ? "bg-[#5a7d58] hover:bg-[#4a6c49]" : ""} onClick={() => setResponse("accepted")}>
                          <CheckCircle2 className="h-4 w-4 mr-2" />
                          Accept session
                        </Button>
                        <Button variant={response === "declined" ? "destructive" : "outline"} onClick={() => setResponse("declined")}>
                          <XCircle className="h-4 w-4 mr-2" />
                          Decline session
                        </Button>
                      </div>
                      {response === "declined" && (
                        <div className="space-y-1.5">
                          <Label className="text-xs">Notes</Label>
                          <Textarea value={declineNotes} onChange={(e) => setDeclineNotes(e.target.value)} rows={3} />
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="grid gap-3 sm:grid-cols-2">
                      <Button variant={response === "accepted" ? "default" : "outline"} className={response === "accepted" ? "bg-[#5a7d58] hover:bg-[#4a6c49]" : ""} onClick={() => setResponse("accepted")}>
                        <CheckCircle2 className="h-4 w-4 mr-2" />
                        I can attend
                      </Button>
                      <Button variant={response === "declined" ? "destructive" : "outline"} onClick={() => setResponse("declined")}>
                        <XCircle className="h-4 w-4 mr-2" />
                        I cannot attend
                      </Button>
                    </div>
                  )}

                  {response === "declined" && !isParticipantInvite && (
                    <div className="space-y-4">
                      <div className="rounded-md border border-amber-200 bg-amber-50 p-3 flex gap-2">
                        <AlertCircle className="h-4 w-4 text-amber-700 mt-0.5 shrink-0" />
                        <p className="text-sm text-amber-800">Please choose one or more alternative slots from the lead mediator's Mediation Sessions calendar.</p>
                      </div>
                      <div className="grid gap-3 lg:grid-cols-[minmax(240px,300px)_minmax(0,1fr)]" data-testid="session-public-slot-picker">
                        <PublicAvailabilityCalendar
                          selectedDate={selectedDate}
                          availableDates={availableDates}
                          isLoadingDates={availableDatesQuery.isLoading}
                          onDateSelect={setSelectedDate}
                          onMonthChange={(next) => {
                            setMonth(next);
                            setSelectedDate(null);
                          }}
                        />
                        <div className="rounded-md border border-stone-200 bg-white p-3 min-w-0">
                          <p className="text-xs text-stone-500 uppercase tracking-wide">Available times</p>
                          {availableDatesQuery.data?.bookingPaused ? (
                            <p className="text-sm text-amber-700 mt-2">{availableDatesQuery.data.message || "Calendar availability is temporarily unavailable."}</p>
                          ) : availableDatesQuery.error ? (
                            <p className="text-sm text-amber-700 mt-2">{availableDatesQuery.error.message}</p>
                          ) : !selectedDate ? (
                            <p className="text-sm text-stone-500 mt-2">Select an available date.</p>
                          ) : availableSlotsQuery.isLoading ? (
                            <div className="flex items-center gap-2 text-sm text-stone-500 mt-2">
                              <Loader2 className="h-4 w-4 animate-spin" />
                              Loading slots...
                            </div>
                          ) : !availableSlotsQuery.data?.slots?.length ? (
                            <p className="text-sm text-stone-500 mt-2">No {duration}-minute slots on this date.</p>
                          ) : (
                            <div className="grid grid-cols-2 gap-2 mt-3">
                              {availableSlotsQuery.data.slots.map((slot) => {
                                const key = new Date(slot.startAt).toISOString();
                                const selected = selectedSlotKeys.has(key);
                                return (
                                  <Button
                                    key={key}
                                    type="button"
                                    variant={selected ? "default" : "outline"}
                                    className={selected ? "bg-[#5a7d58] hover:bg-[#4a6c49] text-white" : ""}
                                    onClick={() => toggleAlternativeSlot(slot)}
                                    data-testid={`button-public-session-slot-${slot.time}`}
                                  >
                                    {slot.time}-{slot.endTime}
                                  </Button>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      </div>
                      {selectedAlternativeSlots.length > 0 && (
                        <div className="rounded-md border border-stone-200 bg-stone-50 p-3">
                          <p className="text-xs font-medium text-stone-600">Selected alternatives</p>
                          <div className="mt-2 space-y-1">
                            {selectedAlternativeSlots.map((slot) => (
                              <div key={new Date(slot.startAt).toISOString()} className="flex items-center justify-between gap-2 text-sm">
                                <span className="min-w-0 break-words">{formatUkWallClockDateTime(slot.startAt, { dateStyle: "full", timeStyle: "short" })}</span>
                                <Button type="button" variant="ghost" size="sm" className="h-7 px-2 shrink-0" onClick={() => toggleAlternativeSlot(slot)}>
                                  Remove
                                </Button>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                      <div className="space-y-1.5">
                        <Label className="text-xs">Notes</Label>
                        <Textarea value={declineNotes} onChange={(e) => setDeclineNotes(e.target.value)} rows={3} />
                      </div>
                    </div>
                  )}

                  <Button className="w-full bg-[#5a7d58] hover:bg-[#4a6c49] text-white" disabled={!canSubmit || respondMutation.isPending} onClick={() => respondMutation.mutate()}>
                    {respondMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                    Submit response
                  </Button>
                  {respondMutation.error && <p className="text-sm text-red-600">{respondMutation.error.message}</p>}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
