import { useState, useEffect } from "react";
import { useRoute } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, parseApiError, queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Calendar as CalendarIcon, Clock, Check, ChevronLeft, ChevronRight, AlertCircle, CreditCard } from "lucide-react";
import { BFMLogoMark } from "@/components/bfm-logo";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { formatUkWallClockDate } from "@/lib/date-time";
import { formatAppointmentDate, formatAppointmentDateTime, formatAppointmentTime, type BookingTimeBasis } from "@shared/booking-time";

// Calendar-backed service slots are real instants; legacy availability uses
// wall-clock-as-UTC. The slot API supplies each exact instant and its time basis.
// Calendar date navigation itself uses UTC date containers for stable day keys.
function formatDateForApi(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function formatDateDisplay(date: Date): string {
  return formatUkWallClockDate(date, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}

function parseBookingDeepLinkDate(value: string | null): Date | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return formatDateForApi(date) === value ? date : null;
}

function isValidBookingDeepLinkDate(value: string | null): boolean {
  return parseBookingDeepLinkDate(value) !== null;
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function MiniCalendar({
  selectedDate,
  onDateSelect,
  availableDates,
  isLoadingDates,
  onMonthChange,
  initialMonth,
}: {
  selectedDate: Date | null;
  onDateSelect: (date: Date) => void;
  availableDates?: Set<string>;
  isLoadingDates?: boolean;
  onMonthChange?: (year: number, month: number) => void;
  initialMonth?: Date;
}) {
  const [viewMonth, setViewMonth] = useState(() => {
    if (initialMonth) return new Date(initialMonth.getFullYear(), initialMonth.getMonth(), 1);
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });

  const nowLocal = new Date();
  const today = new Date(Date.UTC(nowLocal.getFullYear(), nowLocal.getMonth(), nowLocal.getDate()));

  const year = viewMonth.getFullYear();
  const month = viewMonth.getMonth();
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const handleMonthChange = (newMonth: Date) => {
    setViewMonth(newMonth);
    onMonthChange?.(newMonth.getFullYear(), newMonth.getMonth());
  };

  const prevMonth = () => handleMonthChange(new Date(year, month - 1, 1));
  const nextMonth = () => handleMonthChange(new Date(year, month + 1, 1));

  const cells: (number | null)[] = [];
  for (let i = 0; i < firstDay; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  return (
    <div className="w-full">
      <div className="flex items-center justify-between mb-4">
        <Button variant="ghost" size="icon" onClick={prevMonth} data-testid="button-prev-month">
          <ChevronLeft className="w-4 h-4" />
        </Button>
        <span className="text-sm font-semibold" data-testid="text-calendar-month">
          {MONTHS[month]} {year}
        </span>
        <Button variant="ghost" size="icon" onClick={nextMonth} data-testid="button-next-month">
          <ChevronRight className="w-4 h-4" />
        </Button>
      </div>
      <div className="grid grid-cols-7 gap-1 mb-1">
        {DAYS.map(d => (
          <div key={d} className="text-center text-xs text-muted-foreground font-medium py-1">{d}</div>
        ))}
      </div>
      {isLoadingDates ? (
        <div className="flex items-center justify-center py-8" data-testid="loading-dates">
          <div className="animate-spin rounded-full h-6 w-6 border-2 border-[#5a7d58] border-t-transparent" />
          <span className="ml-2 text-sm text-muted-foreground">Loading availability...</span>
        </div>
      ) : (
        <div className="grid grid-cols-7 gap-1">
          {cells.map((day, idx) => {
            if (day === null) return <div key={`e-${idx}`} />;
            const cellDate = new Date(Date.UTC(year, month, day));
            const isPast = cellDate < today;
            const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
            const isAvailable = availableDates ? availableDates.has(dateStr) : true;
            const isSelected = selectedDate && cellDate.getTime() === selectedDate.getTime();
            const isToday = cellDate.getTime() === today.getTime();
            // The server's `availableDates` set is the single source of truth
            // for which days are bookable — including weekends. Mediators who
            // do not want Saturday/Sunday bookings simply do not create
            // availability events on those days.
            const disabled = isPast || !isAvailable;

            return (
              <button
                key={day}
                disabled={disabled}
                onClick={() => onDateSelect(cellDate)}
                className={`
                  relative h-10 w-full rounded-md text-sm font-medium transition-colors
                  ${disabled ? "text-muted-foreground/30 cursor-not-allowed" : "hover:bg-[#a7baa4]/20 cursor-pointer"}
                  ${isSelected ? "bg-[#5a7d58] text-white hover:bg-[#5a7d58]" : ""}
                  ${isToday && !isSelected ? "border border-[#5a7d58] text-[#5a7d58]" : ""}
                `}
                data-testid={`button-date-${day}`}
              >
                {day}
                {isAvailable && !isPast && (
                  <span className={`absolute bottom-0.5 left-1/2 -translate-x-1/2 w-1.5 h-1.5 rounded-full ${isSelected ? "bg-white" : "bg-[#5a7d58]"}`} />
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

interface ServiceInfo {
  id: string;
  name: string;
  description: string | null;
  category: string;
  priceInfo: string | null;
  paymentAmountPence: number;
  paymentCurrency: string;
  formattedPaymentAmount: string;
}

type BankTransferSettings = {
  accountName: string;
  sortCode: string;
  accountNumber: string;
  iban?: string;
  swift?: string;
  instructions?: string;
};

type OnboardingDetails = {
  fullName: string;
  dateOfBirth: string;
  addressLine1: string;
  postcode: string;
  email: string;
  phone: string;
  caseType: string;
  caseSubtype: string;
  caseDescription: string;
  howHeard: string;
  termsConsent: boolean;
  childrenDetails: string;
};

const CASE_TYPES = ["Family", "Workplace", "Civil", "Commercial"] as const;
const FAMILY_SUBTYPES = ["Child arrangements (CA)", "Property & finance (PF)", "All issues mediation (AIM)"] as const;
const OTHER_SUBTYPES = ["General mediation", "Other"] as const;

function emptyOnboardingDetails(): OnboardingDetails {
  return {
    fullName: "",
    dateOfBirth: "",
    addressLine1: "",
    postcode: "",
    email: "",
    phone: "",
    caseType: "",
    caseSubtype: "",
    caseDescription: "",
    howHeard: "",
    termsConsent: false,
    childrenDetails: "",
  };
}

function validateOnboardingDetails(details: OnboardingDetails, isClientA: boolean): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!details.fullName.trim()) errors.fullName = "Full name is required";
  if (!details.dateOfBirth.trim()) errors.dateOfBirth = "Date of birth is required";
  if (!details.addressLine1.trim()) errors.addressLine1 = "Address first line is required";
  if (!details.postcode.trim()) errors.postcode = "Postcode is required";
  if (!details.email.trim()) errors.email = "Email is required";
  if (details.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(details.email.trim())) errors.email = "Enter a valid email";
  if (!details.phone.trim()) errors.phone = "Phone is required";
  if (!details.caseType.trim()) errors.caseType = "Case type is required";
  if (!details.caseSubtype.trim()) errors.caseSubtype = "Case subtype is required";
  if (isClientA && !details.caseDescription.trim()) errors.caseDescription = "Case description is required";
  if (isClientA && !details.howHeard.trim()) errors.howHeard = "How-heard is required";
  if (!details.termsConsent) errors.termsConsent = "Terms consent is required";
  return errors;
}

export default function BookPage() {
  const [, params] = useRoute("/book/:token");
  const token = params?.token;
  const searchParams = new URLSearchParams(window.location.search);
  const paymentReturn = searchParams.get("payment");
  const returnAppointmentId = searchParams.get("appointmentId");
  const returnSessionId = searchParams.get("session_id")?.trim().replace(/\?+$/, "") || null;
  const requestedServiceTypeId = searchParams.get("serviceTypeId");
  const requestedDateParam = searchParams.get("date");
  const requestedDate = isValidBookingDeepLinkDate(requestedDateParam) ? requestedDateParam : null;

  const [selectedServiceId, setSelectedServiceId] = useState<string>("");
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [selectedTimes, setSelectedTimes] = useState<string[]>([]);
  const [step, setStep] = useState<"service" | "date" | "time" | "details" | "confirm" | "success">("service");
  const [bookingResult, setBookingResult] = useState<{ appointmentId: string; dateTime: Date; timeBasis: BookingTimeBasis; duration: number; serviceTypeName: string; status: string; holdExpiresAt?: string | null; xeroInvoiceUrl?: string | null; xeroInvoiceNumber?: string | null; xeroInvoiceEmailSent?: boolean; bankTransfer?: BankTransferSettings | null } | null>(null);
  const [onboardingDetails, setOnboardingDetails] = useState<OnboardingDetails>(() => emptyOnboardingDetails());
  const [onboardingErrors, setOnboardingErrors] = useState<Record<string, string>>({});
  const [calendarMonth, setCalendarMonth] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  });
  const [calendarInitialMonth, setCalendarInitialMonth] = useState<Date | undefined>(undefined);

  const { data: tokenData, isLoading: tokenLoading, error: tokenError } = useQuery<{
    firstName: string;
    lastName: string;
    dateOfBirth: string;
    email: string;
    phone: string;
    addressLine1: string;
    postcode: string;
    partyRole: string;
    caseRef: string;
    caseType: string;
    caseSubtype: string;
    caseDescription?: string;
    howHeard?: string;
    bookingAlreadyUsed: boolean;
    existingAppointment: {
      appointmentId: string;
      dateTime: string;
      dateTimeBasis: BookingTimeBasis;
      duration: number;
      status: string;
      paymentStatus: string;
      serviceTypeId: string | null;
      serviceTypeName: string | null;
      holdExpiresAt: string | null;
    } | null;
    availableServices: ServiceInfo[];
  }>({
    queryKey: ["/api/booking", token],
    queryFn: async () => {
      const res = await fetch(`/api/booking/${token}`);
      if (!res.ok) throw new Error("Invalid booking link");
      return res.json();
    },
    enabled: !!token,
  });

  const selectedService = tokenData?.availableServices?.find(s => s.id === selectedServiceId);
  const isClientA = tokenData?.partyRole === "A";

  const { data: returnPaymentStatus, isLoading: returnPaymentLoading, isError: returnPaymentError, failureCount: returnPaymentFailureCount } = useQuery<{
    appointmentId: string;
    status: string;
    paymentStatus: string;
    paymentFailureReason?: string | null;
    dateTime: string;
    duration: number;
    serviceTypeId: string | null;
    reconciliationAction?: string;
    calendarSyncStatus?: "pending" | "processing" | "succeeded" | "failed" | "skipped" | null;
  }>({
    queryKey: ["/api/booking", token, "payment-status", returnAppointmentId, returnSessionId],
    queryFn: async () => {
      const sessionQuery = returnSessionId ? `&session_id=${encodeURIComponent(returnSessionId)}` : "";
      const paymentQuery = paymentReturn ? `&payment=${encodeURIComponent(paymentReturn)}` : "";
      const res = await fetch(`/api/booking/${token}/payment-status?appointmentId=${returnAppointmentId}${sessionQuery}${paymentQuery}`);
      if (!res.ok) throw new Error("Failed to load payment status");
      return res.json();
    },
    enabled: !!token && !!returnAppointmentId && (paymentReturn === "success" || (paymentReturn === "cancelled" && !!returnSessionId)),
    refetchInterval: (query) => {
      const data = query.state.data;
      return data?.status === "confirmed" && data?.paymentStatus === "paid" ? false : 3000;
    },
  });

  useEffect(() => {
    if (!tokenData) return;
    setOnboardingDetails((current) => ({
      ...current,
      fullName: current.fullName || `${tokenData.firstName || ""} ${tokenData.lastName || ""}`.trim(),
      dateOfBirth: current.dateOfBirth || tokenData.dateOfBirth || "",
      addressLine1: current.addressLine1 || tokenData.addressLine1 || "",
      postcode: current.postcode || tokenData.postcode || "",
      email: current.email || tokenData.email || "",
      phone: current.phone || tokenData.phone || "",
      caseType: current.caseType || tokenData.caseType || "Family",
      caseSubtype: current.caseSubtype || tokenData.caseSubtype || "Child arrangements (CA)",
      caseDescription: isClientA ? current.caseDescription || tokenData.caseDescription || "" : "",
      howHeard: isClientA ? current.howHeard || tokenData.howHeard || "" : "",
    }));
  }, [tokenData, isClientA]);

  useEffect(() => {
    if (!tokenData || !requestedServiceTypeId) return;
    const requestedService = tokenData.availableServices?.find((service) => service.id === requestedServiceTypeId);
    if (!requestedService) return;

    setSelectedServiceId(requestedServiceTypeId);
    setSelectedTimes([]);
    if (isValidBookingDeepLinkDate(requestedDate)) {
      const parsedDate = parseBookingDeepLinkDate(requestedDate);
      setSelectedDate(parseBookingDeepLinkDate(requestedDate));
      if (parsedDate) {
        setCalendarMonth(formatDateForApi(parsedDate).slice(0, 7));
        setCalendarInitialMonth(new Date(parsedDate.getUTCFullYear(), parsedDate.getUTCMonth(), 1));
      }
    } else {
      setSelectedDate(null);
    }
    setStep(requestedDate ? "time" : "date");
  }, [tokenData, requestedServiceTypeId, requestedDate]);

  const { data: slots, isLoading: slotsLoading } = useQuery<Array<{ startAt: string; endAt: string; time: string; endTime: string; duration: number; timeBasis: BookingTimeBasis }>>({
    queryKey: ["/api/booking", token, "slots", { serviceTypeId: selectedServiceId, date: selectedDate ? formatDateForApi(selectedDate) : "" }],
    queryFn: async () => {
      if (!selectedDate || !token) return [];
      const res = await fetch(`/api/booking/${token}/slots?serviceTypeId=${selectedServiceId}&date=${formatDateForApi(selectedDate)}`);
      if (!res.ok) throw new Error("Failed to load slots");
      return res.json();
    },
    enabled: !!selectedDate && !!token && !!selectedServiceId && step === "time",
  });
  const displaySlots = slots ? Array.from(new Map(slots.map((slot) => [slot.time, slot])).values()) : [];

  const { data: availableDatesData, isLoading: datesLoading, isError: datesError } = useQuery<{ dates: string[]; bookingPaused: boolean }>({
    queryKey: ["/api/booking", token, "available-dates", { serviceTypeId: selectedServiceId, month: calendarMonth }],
    queryFn: async () => {
      const res = await fetch(`/api/booking/${token}/available-dates?serviceTypeId=${selectedServiceId}&month=${calendarMonth}`);
      if (!res.ok) throw new Error("Failed to load available dates");
      return res.json();
    },
    enabled: !!token && !!selectedServiceId && step === "date",
  });

  const availableDatesRaw = availableDatesData?.dates;
  const bookingPaused = availableDatesData?.bookingPaused ?? false;
  const availableDatesSet = datesError ? new Set<string>() : (availableDatesRaw ? new Set(availableDatesRaw) : undefined);

  const bookMutation = useMutation({
    mutationFn: async (bookingMode: "hold" | "stripe_checkout") => {
      if (!selectedDate || selectedTimes.length === 0) throw new Error("Date and time required");
      const preferredSlots = (slots ?? [])
        .filter((slot) => selectedTimes.includes(slot.time))
        .map((slot) => ({ startAt: slot.startAt, timeBasis: slot.timeBasis }));
      if (preferredSlots.length === 0) throw new Error("Selected time is no longer available. Please choose it again.");

      const res = await apiRequest("POST", `/api/booking/${token}/appointment`, {
        serviceTypeId: selectedServiceId,
        preferredSlots,
        mode: bookingMode,
        onboardingDetails,
      });
      return res.json();
    },
    onSuccess: (data) => {
      if (data.checkoutUrl) {
        window.location.assign(data.checkoutUrl);
        return;
      }
      setBookingResult({
        appointmentId: data.appointmentId,
        dateTime: new Date(data.dateTime),
        timeBasis: data.timeBasis,
        duration: data.duration,
        serviceTypeName: data.serviceTypeName,
        status: data.status,
        holdExpiresAt: data.holdExpiresAt || null,
        xeroInvoiceUrl: data.xeroInvoiceUrl || null,
        xeroInvoiceNumber: data.xeroInvoiceNumber || null,
        xeroInvoiceEmailSent: Boolean(data.xeroInvoiceEmailSent),
        bankTransfer: data.bankTransfer || null,
      });
      setStep("success");
    },
    onError: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/booking", token, "slots"] });
      queryClient.invalidateQueries({ queryKey: ["/api/booking", token, "available-dates"] });
    },
  });

  const bankTransferInFlightMutation = useMutation({
    mutationFn: async () => {
      if (!bookingResult?.appointmentId) return;
      await apiRequest("POST", `/api/booking/${token}/appointments/${bookingResult.appointmentId}/bank-transfer-in-flight`, {});
    },
  });
  const bookingErrorMessage = bookMutation.isError
    ? parseApiError(bookMutation.error).userMessage
    : null;
  const pendingBookingMode = bookMutation.isPending ? bookMutation.variables : null;
  const pendingBookingTitle = pendingBookingMode === "stripe_checkout"
    ? "Creating your secure invoice"
    : pendingBookingMode === "hold"
      ? "Holding your appointment"
      : null;
  const pendingBookingDetail = pendingBookingMode === "stripe_checkout"
    ? "Please do not refresh or close this page. Your slot is being reserved and your Xero payment link is being prepared."
    : pendingBookingMode === "hold"
      ? "We are reserving the slot while payment is pending."
      : null;

  const handleServiceSelect = (serviceId: string) => {
    setSelectedServiceId(serviceId);
    setSelectedDate(null);
    setSelectedTimes([]);
    setStep("date");
  };

  const handleDateSelect = (date: Date) => {
    setSelectedDate(date);
    setSelectedTimes([]);
    setStep("time");
  };

  const handleTimeToggle = (time: string) => {
    setSelectedTimes([time]);
  };

  const handleContinueToConfirm = () => {
    const errors = validateOnboardingDetails(onboardingDetails, isClientA);
    setOnboardingErrors(errors);
    if (Object.keys(errors).length > 0) return;
    setStep("confirm");
  };

  const updateOnboarding = <K extends keyof OnboardingDetails>(field: K, value: OnboardingDetails[K]) => {
    setOnboardingDetails((current) => ({ ...current, [field]: value }));
    setOnboardingErrors((current) => {
      if (!current[field]) return current;
      const next = { ...current };
      delete next[field];
      return next;
    });
  };

  const handleBack = () => {
    if (step === "date") {
      setStep("service");
      setSelectedServiceId("");
      setSelectedDate(null);
      setSelectedTimes([]);
    } else if (step === "time") {
      setStep("date");
      setSelectedDate(null);
      setSelectedTimes([]);
    } else if (step === "details") {
      setStep("time");
    } else if (step === "confirm") {
      setStep("details");
    }
  };

  const canContinue = selectedTimes.length >= 1;

  if (tokenLoading) {
    return (
      <div className="min-h-screen bg-[#faf8f5] flex items-center justify-center">
        <div className="text-center space-y-4">
          <Skeleton className="h-12 w-12 rounded-xl mx-auto" />
          <Skeleton className="h-4 w-48 mx-auto" />
        </div>
      </div>
    );
  }

  if (tokenError || !tokenData) {
    return (
      <div className="min-h-screen bg-[#faf8f5] flex items-center justify-center p-4">
        <Card className="max-w-md w-full">
          <CardContent className="pt-8 pb-8 text-center space-y-4">
            <div className="w-12 h-12 rounded-full bg-red-100 flex items-center justify-center mx-auto">
              <AlertCircle className="w-6 h-6 text-red-600" />
            </div>
            <h2 className="text-lg font-semibold">Invalid Booking Link</h2>
            <p className="text-sm text-muted-foreground">
              This booking link is invalid or has expired. Please contact your mediator for a new link.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (paymentReturn === "success") {
    const isConfirmed = returnPaymentStatus?.status === "confirmed" && returnPaymentStatus.paymentStatus === "paid";
    const needsMiamArrangement = returnPaymentStatus?.paymentFailureReason === "paid_needs_miam_arrangement";
    const calendarSyncStatus = returnPaymentStatus?.calendarSyncStatus;
    const calendarSyncPending = calendarSyncStatus === "pending" || calendarSyncStatus === "processing";
    const calendarSyncFailed = calendarSyncStatus === "failed";
    const hasStatusCheckIssue = returnPaymentError && returnPaymentFailureCount >= 2;
    return (
      <div className="min-h-screen bg-[#faf8f5]">
        <div className="bg-white border-b shadow-sm">
          <div className="max-w-2xl mx-auto px-4 py-4 flex items-center gap-3">
            <BFMLogoMark size={40} />
            <div>
              <h1 className="text-base font-semibold text-gray-800" style={{ fontFamily: "Agrandir, sans-serif" }}>
                Brighter Future Mediation
              </h1>
              <p className="text-xs text-muted-foreground">Book Your Appointment</p>
            </div>
          </div>
        </div>
        <div className="max-w-2xl mx-auto px-4 py-8">
          <Card data-testid="card-payment-return">
            <CardContent className="pt-8 pb-8 text-center space-y-4">
              <div className="w-14 h-14 rounded-full bg-[#a7baa4]/30 flex items-center justify-center mx-auto">
                {isConfirmed ? <Check className="w-7 h-7 text-[#5a7d58]" /> : <CreditCard className="w-7 h-7 text-[#5a7d58]" />}
              </div>
              <h2 className="text-xl font-semibold" style={{ fontFamily: "Agrandir, sans-serif" }}>
                {isConfirmed ? "Payment received and appointment confirmed" : needsMiamArrangement ? "Payment received" : "Payment processing"}
              </h2>
              <p className="text-sm text-muted-foreground">
                {isConfirmed
                  ? calendarSyncPending
                    ? "Payment received and appointment confirmed. Your calendar invitation is being prepared."
                    : calendarSyncFailed
                      ? "Payment received and appointment confirmed. BFM has been notified about the calendar invitation."
                      : `Your appointment has been confirmed. A confirmation email has been sent to ${tokenData.email}.`
                  : needsMiamArrangement
                    ? "Your payment has been received. BFM will arrange and confirm a MIAM mediator for you shortly."
                  : hasStatusCheckIssue
                    ? "Your payment may still be processing. BFM will confirm the appointment shortly once Stripe payment confirmation is received."
                  : returnPaymentLoading
                    ? "Checking your payment status..."
                    : "Stripe has returned you to BFM. We are waiting for payment confirmation; this page will update automatically."
                }
              </p>
              {!isConfirmed && returnPaymentStatus && (
                <p className="text-xs text-muted-foreground">
                  Current status: {returnPaymentStatus.paymentStatus} / {returnPaymentStatus.status}
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  if (paymentReturn === "cancelled") {
    return (
      <div className="min-h-screen bg-[#faf8f5] flex items-center justify-center p-4">
        <Card className="max-w-md w-full" data-testid="card-payment-cancelled">
          <CardContent className="pt-8 pb-8 text-center space-y-4">
            <div className="w-12 h-12 rounded-full bg-amber-100 flex items-center justify-center mx-auto">
              <AlertCircle className="w-6 h-6 text-amber-600" />
            </div>
            <h2 className="text-lg font-semibold">Payment cancelled</h2>
            <p className="text-sm text-muted-foreground">
              Your payment was not completed. Your appointment slot remains on a payment hold until the hold deadline. Please contact Brighter Future Mediation if you need help completing payment.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (tokenData.bookingAlreadyUsed && tokenData.existingAppointment) {
    const existing = tokenData.existingAppointment;
    return (
      <div className="min-h-screen bg-[#faf8f5]">
        <div className="bg-white border-b shadow-sm">
          <div className="max-w-2xl mx-auto px-4 py-4 flex items-center gap-3">
            <BFMLogoMark size={40} />
            <div>
              <h1 className="text-base font-semibold text-gray-800" style={{ fontFamily: "Agrandir, sans-serif" }}>
                Brighter Future Mediation
              </h1>
              <p className="text-xs text-muted-foreground">Book Your Appointment</p>
            </div>
          </div>
        </div>
        <div className="max-w-2xl mx-auto px-4 py-8">
          <Card className="max-w-md mx-auto" data-testid="card-booking-link-already-used">
            <CardContent className="pt-8 pb-8 text-center space-y-4">
              <div className="w-12 h-12 rounded-full bg-amber-100 flex items-center justify-center mx-auto">
                <AlertCircle className="w-6 h-6 text-amber-600" />
              </div>
              <h2 className="text-lg font-semibold">Booking link already used</h2>
              <p className="text-sm text-muted-foreground">
                This booking link has already been used to reserve an appointment. Please use your payment link or contact Brighter Future Mediation if you need help.
              </p>
              <div className="bg-muted/50 rounded-lg p-4 text-left space-y-2">
                <div className="flex items-center gap-2">
                  <CalendarIcon className="w-4 h-4 text-[#5a7d58]" />
                  <span className="text-sm font-medium" data-testid="text-existing-booking-date">
                    {formatAppointmentDateTime(existing.dateTime, existing.dateTimeBasis)}
                  </span>
                </div>
                {existing.serviceTypeName && (
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-xs text-[#5a7d58] border-[#a7baa4]">
                      {existing.serviceTypeName}
                    </Badge>
                  </div>
                )}
                {existing.holdExpiresAt && existing.status !== "confirmed" && (
                  <p className="text-xs text-muted-foreground">
                    Hold deadline: {formatAppointmentDateTime(existing.holdExpiresAt, "instant")}
                  </p>
                )}
              </div>
              <a
                href="mailto:info@brighterfuturemediation.co.uk"
                className="inline-flex items-center text-sm text-[#5a7d58] underline underline-offset-2 hover:text-[#4a6b48]"
                data-testid="link-booking-used-contact"
              >
                info@brighterfuturemediation.co.uk
              </a>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#faf8f5]">
      <div className="bg-white border-b shadow-sm">
        <div className="max-w-2xl mx-auto px-4 py-4 flex items-center gap-3">
          <BFMLogoMark size={40} />
          <div>
            <h1 className="text-base font-semibold text-gray-800" style={{ fontFamily: "Agrandir, sans-serif" }}>
              Brighter Future Mediation
            </h1>
            <p className="text-xs text-muted-foreground">Book Your Appointment</p>
          </div>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-8">
        <div className="mb-6">
          <p className="text-sm text-muted-foreground" data-testid="text-booking-greeting">
            Hello {tokenData.firstName}, {step === "service" ? "please select a service for your appointment." : "please select a date and time for your appointment."}
          </p>
          {selectedService && step !== "service" && (
            <div className="mt-2 p-3 bg-white rounded-lg border border-[#a7baa4]/40" data-testid="text-service-type">
              <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium">Service</p>
              <p className="text-sm font-semibold text-[#5a7d58] mt-0.5">{selectedService.name}</p>
              {selectedService.priceInfo && (
                <p className="text-xs text-muted-foreground mt-1">{selectedService.priceInfo}</p>
              )}
              <p className="text-xs font-medium text-[#5a7d58] mt-1">{selectedService.formattedPaymentAmount}</p>
            </div>
          )}
        </div>

        {(() => {
          const steps = [
            { key: "service", label: "Service" },
            { key: "date", label: "Date" },
            { key: "time", label: "Time" },
            { key: "details", label: "Details" },
            { key: "confirm", label: "Confirm" },
          ];
          const stepOrder = steps.map(s => s.key);
          const currentIdx = stepOrder.indexOf(step === "success" ? "confirm" : step);

          return (
            <div className="flex gap-2 mb-6">
              {steps.map((s, i) => {
                const isPast = i < currentIdx || step === "success";
                const isCurrent = stepOrder[i] === step;
                return (
                  <div key={s.key} className="flex items-center gap-2">
                    <div
                      className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold transition-colors
                        ${isCurrent || isPast ? "bg-[#5a7d58] text-white" : "bg-gray-200 text-gray-500"}
                      `}
                    >
                      {isPast && !isCurrent ? <Check className="w-3.5 h-3.5" /> : i + 1}
                    </div>
                    <span className="text-xs text-muted-foreground hidden sm:inline">{s.label}</span>
                    {i < steps.length - 1 && <div className="w-8 h-px bg-gray-300" />}
                  </div>
                );
              })}
            </div>
          );
        })()}

        {step === "success" && bookingResult ? (
          <Card data-testid="card-booking-success">
            <CardContent className="pt-8 pb-8 text-center space-y-4">
              <div className="w-14 h-14 rounded-full bg-[#a7baa4]/30 flex items-center justify-center mx-auto">
                <Check className="w-7 h-7 text-[#5a7d58]" />
              </div>
              <h2 className="text-xl font-semibold" style={{ fontFamily: "Agrandir, sans-serif" }}>
                {bookingResult.status === "confirmed" ? "Appointment Confirmed" : "Payment Hold Created"}
              </h2>
              <p className="text-sm text-muted-foreground">
                {bookingResult.status === "confirmed"
                  ? `Your appointment has been confirmed. A confirmation email has been sent to ${tokenData.email}.`
                  : `Your appointment slot is reserved in the CRM pending payment. Calendar details are sent only after payment is received before the hold deadline.`
                }
              </p>
              {bookingResult.status !== "confirmed" && bookingResult.holdExpiresAt && (
                <p className="text-xs text-muted-foreground">
                  Hold deadline: {formatAppointmentDateTime(bookingResult.holdExpiresAt, "instant")}
                </p>
              )}
              {bookingResult.xeroInvoiceUrl && (
                <div className="space-y-3 rounded-lg border bg-muted/30 p-4 text-left max-w-md mx-auto" data-testid="xero-invoice-payment-panel">
                  <Button
                    className="bg-[#5a7d58] hover:bg-[#4a6d48] w-full"
                    onClick={() => window.open(bookingResult.xeroInvoiceUrl!, "_blank", "noopener,noreferrer")}
                    data-testid="button-pay-xero-invoice"
                  >
                    <CreditCard className="w-4 h-4 mr-2" />
                    Pay invoice now
                  </Button>
                  <p className="text-xs text-muted-foreground">
                    {bookingResult.xeroInvoiceEmailSent
                      ? `We have also emailed this invoice link to ${tokenData.email}.`
                      : "Your invoice link is ready. Please keep this page open until you have opened the payment link."}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Card payment is available only if enabled on the Xero invoice page. Bank transfer can be made using the details below.
                  </p>
                  {bookingResult.xeroInvoiceNumber && (
                    <div className="rounded-md bg-background p-3 text-sm">
                      <p className="text-xs text-muted-foreground">Payment reference</p>
                      <div className="flex items-center justify-between gap-2">
                        <strong>{bookingResult.xeroInvoiceNumber}</strong>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => navigator.clipboard?.writeText(bookingResult.xeroInvoiceNumber || "")}
                          data-testid="button-copy-xero-reference"
                        >
                          Copy reference
                        </Button>
                      </div>
                      <p className="mt-2 text-xs text-muted-foreground">Use the payment reference shown here when paying by bank transfer.</p>
                    </div>
                  )}
                  {bookingResult.bankTransfer && (
                    <div className="rounded-md bg-background p-3 text-xs space-y-1">
                      <p className="font-medium">Bank transfer is preferred</p>
                      {bookingResult.bankTransfer.accountName && <p>Account name: {bookingResult.bankTransfer.accountName}</p>}
                      {bookingResult.bankTransfer.sortCode && <p>Sort code: {bookingResult.bankTransfer.sortCode}</p>}
                      {bookingResult.bankTransfer.accountNumber && <p>Account number: {bookingResult.bankTransfer.accountNumber}</p>}
                      {bookingResult.bankTransfer.iban && <p>IBAN: {bookingResult.bankTransfer.iban}</p>}
                      {bookingResult.bankTransfer.swift && <p>SWIFT/BIC: {bookingResult.bankTransfer.swift}</p>}
                      <p className="text-muted-foreground">{bookingResult.bankTransfer.instructions}</p>
                    </div>
                  )}
                  <Button
                    variant="outline"
                    className="w-full"
                    onClick={() => bankTransferInFlightMutation.mutate()}
                    disabled={bankTransferInFlightMutation.isPending}
                    data-testid="button-bank-transfer-in-flight"
                  >
                    I've paid by bank transfer
                  </Button>
                  <p className="text-xs text-muted-foreground">
                    This alerts our team but does not confirm your appointment until the payment is reconciled. We will confirm automatically once Xero reports the invoice as paid or staff verify the transfer.
                  </p>
                </div>
              )}
              <div className="bg-muted/50 rounded-lg p-4 text-left space-y-2 max-w-sm mx-auto">
                <div className="flex items-center gap-2">
                  <CalendarIcon className="w-4 h-4 text-[#5a7d58]" />
                  <span className="text-sm font-medium" data-testid="text-confirmed-date">
                    {formatAppointmentDate(bookingResult.dateTime, bookingResult.timeBasis)}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <Clock className="w-4 h-4 text-[#5a7d58]" />
                  <span className="text-sm font-medium" data-testid="text-confirmed-time">
                    {formatAppointmentTime(bookingResult.dateTime, bookingResult.timeBasis)}
                    {" – "}
                    {formatAppointmentTime(new Date(bookingResult.dateTime.getTime() + bookingResult.duration * 60000), bookingResult.timeBasis)}
                    {" "}({bookingResult.duration} min)
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="text-xs text-[#5a7d58] border-[#a7baa4]" data-testid="badge-service-name">
                    {bookingResult.serviceTypeName}
                  </Badge>
                </div>
              </div>
              <p className="text-xs text-muted-foreground mt-4">
                You can close this page. If you need to make changes, please contact your mediator.
              </p>
            </CardContent>
          </Card>
        ) : (
          <>
            {step !== "service" && (
              <Button variant="ghost" size="sm" onClick={handleBack} className="mb-4" disabled={bookMutation.isPending} data-testid="button-back">
                <ChevronLeft className="w-4 h-4 mr-1" /> Back
              </Button>
            )}

            {step === "service" && (
              <Card data-testid="card-select-service">
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <CalendarIcon className="w-4 h-4 text-[#5a7d58]" />
                    Select a Service
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {tokenData.availableServices && tokenData.availableServices.length > 0 ? (
                    <div className="space-y-2">
                      {tokenData.availableServices.map(svc => (
                        <button
                          key={svc.id}
                          className="w-full text-left p-4 rounded-lg border border-gray-200 hover:border-[#5a7d58] hover:bg-[#a7baa4]/5 transition-colors"
                          onClick={() => handleServiceSelect(svc.id)}
                          data-testid={`button-service-${svc.id}`}
                        >
                          <div className="flex items-center justify-between">
                            <div>
                              <p className="text-sm font-semibold text-gray-800">{svc.name}</p>
                              {svc.description && <p className="text-xs text-muted-foreground mt-0.5">{svc.description}</p>}
                            </div>
                            <div className="text-right">
                              <Badge variant="outline" className="text-xs border-[#a7baa4] text-[#5a7d58]">{svc.category}</Badge>
                              <p className="text-xs font-medium text-[#5a7d58] mt-1">{svc.formattedPaymentAmount}</p>
                              {svc.priceInfo && <p className="text-xs text-muted-foreground mt-1">{svc.priceInfo}</p>}
                            </div>
                          </div>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className="text-center py-8">
                      <AlertCircle className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
                      <p className="text-sm text-muted-foreground">No services are currently available for booking.</p>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {step === "date" && (
              <Card data-testid="card-select-date">
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <CalendarIcon className="w-4 h-4 text-[#5a7d58]" />
                    Select a Date
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {bookingPaused ? (
                    <div className="py-6 text-center space-y-3" data-testid="text-booking-paused">
                      <AlertCircle className="w-8 h-8 text-muted-foreground mx-auto" />
                      <p className="text-sm font-medium text-gray-700">No availability for this service yet</p>
                      <p className="text-sm text-muted-foreground">
                        This service is not currently available for online booking. Please contact us directly and we will be happy to help arrange an appointment.
                      </p>
                      <a
                        href="mailto:info@brighterfuturemediation.co.uk"
                        className="inline-flex items-center text-sm text-[#5a7d58] underline underline-offset-2 hover:text-[#4a6b48]"
                        data-testid="link-contact-us"
                      >
                        info@brighterfuturemediation.co.uk
                      </a>
                    </div>
                  ) : (
                    <>
                      <MiniCalendar
                        selectedDate={selectedDate}
                        onDateSelect={handleDateSelect}
                        availableDates={availableDatesSet}
                        isLoadingDates={datesLoading}
                        initialMonth={calendarInitialMonth}
                        onMonthChange={(y, m) => {
                          setCalendarMonth(`${y}-${String(m + 1).padStart(2, "0")}`);
                          setCalendarInitialMonth(new Date(y, m, 1));
                        }}
                      />
                      {!datesLoading && !datesError && availableDatesRaw && availableDatesRaw.length === 0 && (
                        <div className="mt-4 flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50 p-3" data-testid="text-no-availability">
                          <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                          <div className="space-y-1">
                            <p className="text-sm font-medium text-amber-900">No slots available this month</p>
                            <p className="text-sm text-amber-800/80">
                              Try another month, or{" "}
                              <a
                                href="mailto:info@brighterfuturemediation.co.uk"
                                className="underline underline-offset-2 hover:text-amber-900"
                                data-testid="link-contact-us"
                              >
                                contact us
                              </a>{" "}
                              and we&apos;ll find a time for you.
                            </p>
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </CardContent>
              </Card>
            )}

            {step === "time" && selectedDate && (
              <Card data-testid="card-select-time">
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <Clock className="w-4 h-4 text-[#5a7d58]" />
                    Select Your Preferred Time — {formatDateDisplay(selectedDate)}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {slotsLoading ? (
                    <div className="space-y-2">
                      {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-10 w-full" />)}
                    </div>
                  ) : !slots || slots.length === 0 ? (
                    <div className="text-center py-8 space-y-2" data-testid="text-no-slots">
                      <AlertCircle className="w-8 h-8 text-muted-foreground mx-auto" />
                      <p className="text-sm text-muted-foreground">No available times on this date.</p>
                      <Button variant="outline" size="sm" onClick={handleBack} data-testid="button-choose-different-date">
                        Choose a different date
                      </Button>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <p className="text-xs text-muted-foreground">
                        Select your preferred time slot below.
                      </p>
                      <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                        {displaySlots.map(slot => {
                          const isSelected = selectedTimes.includes(slot.time);
                          return (
                            <Button
                              key={slot.time}
                              variant={isSelected ? "default" : "outline"}
                              className={`text-sm ${isSelected ? "bg-[#5a7d58] hover:bg-[#4a6d48]" : "hover:border-[#5a7d58] hover:text-[#5a7d58]"}`}
                              onClick={() => handleTimeToggle(slot.time)}
                              data-testid={`button-time-${slot.time}`}
                            >
                              {slot.time}–{slot.endTime}
                            </Button>
                          );
                        })}
                      </div>
                      {selectedTimes.length > 0 && (
                        <div className="text-xs text-muted-foreground">
                          1 time selected
                        </div>
                      )}
                      <Button
                        className="w-full bg-[#5a7d58] hover:bg-[#4a6d48]"
                        disabled={!canContinue}
                        onClick={() => setStep("details")}
                        data-testid="button-continue-to-confirm"
                      >
                        Continue
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {step === "details" && selectedDate && selectedTimes.length > 0 && (
              <Card data-testid="card-confirm-details">
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <Check className="w-4 h-4 text-[#5a7d58]" />
                    Confirm Your Details
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid sm:grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="booking-full-name">Full name</Label>
                      <Input id="booking-full-name" value={onboardingDetails.fullName} onChange={(e) => updateOnboarding("fullName", e.target.value)} data-testid="input-booking-full-name" />
                      {onboardingErrors.fullName && <p className="text-xs text-red-600">{onboardingErrors.fullName}</p>}
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="booking-dob">Date of birth</Label>
                      <Input id="booking-dob" type="date" value={onboardingDetails.dateOfBirth} onChange={(e) => updateOnboarding("dateOfBirth", e.target.value)} data-testid="input-booking-dob" />
                      {onboardingErrors.dateOfBirth && <p className="text-xs text-red-600">{onboardingErrors.dateOfBirth}</p>}
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="booking-address-1">Address first line</Label>
                      <Input id="booking-address-1" value={onboardingDetails.addressLine1} onChange={(e) => updateOnboarding("addressLine1", e.target.value)} data-testid="input-booking-address-1" />
                      {onboardingErrors.addressLine1 && <p className="text-xs text-red-600">{onboardingErrors.addressLine1}</p>}
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="booking-postcode">Postcode</Label>
                      <Input id="booking-postcode" value={onboardingDetails.postcode} onChange={(e) => updateOnboarding("postcode", e.target.value)} data-testid="input-booking-postcode" />
                      {onboardingErrors.postcode && <p className="text-xs text-red-600">{onboardingErrors.postcode}</p>}
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="booking-email">Email</Label>
                      <Input id="booking-email" type="email" value={onboardingDetails.email} onChange={(e) => updateOnboarding("email", e.target.value)} data-testid="input-booking-email" />
                      {onboardingErrors.email && <p className="text-xs text-red-600">{onboardingErrors.email}</p>}
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="booking-phone">Phone</Label>
                      <Input id="booking-phone" value={onboardingDetails.phone} onChange={(e) => updateOnboarding("phone", e.target.value)} data-testid="input-booking-phone" />
                      {onboardingErrors.phone && <p className="text-xs text-red-600">{onboardingErrors.phone}</p>}
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="booking-case-type">Case type</Label>
                      <select
                        id="booking-case-type"
                        value={onboardingDetails.caseType}
                        onChange={(e) => {
                          const value = e.target.value;
                          updateOnboarding("caseType", value);
                          if (value === "Family") updateOnboarding("caseSubtype", "Child arrangements (CA)");
                          else updateOnboarding("caseSubtype", "General mediation");
                        }}
                        className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                        data-testid="select-booking-case-type"
                      >
                        {CASE_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
                      </select>
                      {onboardingErrors.caseType && <p className="text-xs text-red-600">{onboardingErrors.caseType}</p>}
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="booking-case-subtype">Case subtype</Label>
                      <select
                        id="booking-case-subtype"
                        value={onboardingDetails.caseSubtype}
                        onChange={(e) => updateOnboarding("caseSubtype", e.target.value)}
                        className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                        data-testid="select-booking-case-subtype"
                      >
                        {(onboardingDetails.caseType === "Family" ? FAMILY_SUBTYPES : OTHER_SUBTYPES).map((subtype) => <option key={subtype} value={subtype}>{subtype}</option>)}
                      </select>
                      {onboardingErrors.caseSubtype && <p className="text-xs text-red-600">{onboardingErrors.caseSubtype}</p>}
                    </div>
                  </div>

                  {isClientA && (
                    <>
                      <div className="space-y-1.5">
                        <Label htmlFor="booking-description">Brief description</Label>
                        <Textarea id="booking-description" rows={3} value={onboardingDetails.caseDescription} onChange={(e) => updateOnboarding("caseDescription", e.target.value)} data-testid="textarea-booking-description" />
                        {onboardingErrors.caseDescription && <p className="text-xs text-red-600">{onboardingErrors.caseDescription}</p>}
                      </div>

                    <div className="space-y-1.5">
                      <Label htmlFor="booking-children">Children's details</Label>
                      <Textarea id="booking-children" rows={3} value={onboardingDetails.childrenDetails} onChange={(e) => updateOnboarding("childrenDetails", e.target.value)} data-testid="textarea-booking-children" />
                      {onboardingErrors.childrenDetails && <p className="text-xs text-red-600">{onboardingErrors.childrenDetails}</p>}
                    </div>

                      <div className="space-y-1.5">
                        <Label htmlFor="booking-how-heard">How did you hear about BFM?</Label>
                        <Input id="booking-how-heard" value={onboardingDetails.howHeard} onChange={(e) => updateOnboarding("howHeard", e.target.value)} data-testid="input-booking-how-heard" />
                        {onboardingErrors.howHeard && <p className="text-xs text-red-600">{onboardingErrors.howHeard}</p>}
                      </div>
                    </>
                  )}

                  <div className="flex items-start gap-3 rounded-md border border-[#a7baa4]/40 p-3">
                    <Checkbox
                      id="booking-terms"
                      checked={onboardingDetails.termsConsent}
                      onCheckedChange={(checked) => updateOnboarding("termsConsent", checked === true)}
                      data-testid="checkbox-booking-terms"
                    />
                    <div className="space-y-1">
                      <Label htmlFor="booking-terms" className="text-sm leading-snug">I confirm these details are accurate and agree to the booking terms.</Label>
                      {onboardingErrors.termsConsent && <p className="text-xs text-red-600">{onboardingErrors.termsConsent}</p>}
                    </div>
                  </div>

                  <Button className="w-full bg-[#5a7d58] hover:bg-[#4a6d48]" onClick={handleContinueToConfirm} data-testid="button-details-to-confirm">
                    Review appointment
                  </Button>
                </CardContent>
              </Card>
            )}

            {step === "confirm" && selectedDate && selectedTimes.length > 0 && (
              <Card data-testid="card-confirm-booking">
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <Check className="w-4 h-4 text-[#5a7d58]" />
                    Confirm Your Appointment
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                    <div className="flex items-center gap-2">
                      <CalendarIcon className="w-4 h-4 text-[#5a7d58]" />
                      <span className="text-sm font-medium" data-testid="text-confirm-date">
                        {formatDateDisplay(selectedDate)}
                      </span>
                    </div>
                    <div>
                      <span className="text-xs text-muted-foreground uppercase tracking-wide">
                        Time
                      </span>
                      <div className="mt-1 flex items-center gap-2" data-testid="text-confirm-times">
                        <Clock className="w-3.5 h-3.5 text-[#5a7d58]" />
                        <span className="text-sm font-medium">
                          {selectedTimes[0]} (60 minutes)
                        </span>
                      </div>
                    </div>
                    {selectedService && (
                      <div>
                        <span className="text-xs text-muted-foreground uppercase tracking-wide">Service</span>
                        <p className="text-sm font-medium text-[#5a7d58]">{selectedService.name}</p>
                        <p className="text-sm font-semibold text-[#5a7d58] mt-1">{selectedService.formattedPaymentAmount}</p>
                      </div>
                    )}
                    <div>
                      <span className="text-xs text-muted-foreground uppercase tracking-wide">Format</span>
                      <p className="text-sm font-medium">Online (video call)</p>
                    </div>
                  </div>

                  {bookMutation.isError && (
                    <div className="bg-red-50 border border-red-200 rounded-md p-3 text-sm text-red-700" data-testid="text-booking-error">
                      {bookingErrorMessage || "Failed to book appointment. Please try again."}
                    </div>
                  )}

                  {bookMutation.isPending && pendingBookingTitle && pendingBookingDetail ? (
                    <div className="rounded-lg border border-[#a7baa4]/50 bg-[#a7baa4]/10 p-4 text-center space-y-3" aria-live="polite" data-testid="booking-pending-status">
                      <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-white text-[#5a7d58] shadow-sm">
                        {pendingBookingMode === "stripe_checkout" ? <CreditCard className="h-5 w-5" /> : <Clock className="h-5 w-5" />}
                      </div>
                      <div className="space-y-1">
                        <p className="text-sm font-semibold text-gray-800">{pendingBookingTitle}</p>
                        <p className="text-xs text-muted-foreground">{pendingBookingDetail}</p>
                      </div>
                      <div className="mx-auto h-1.5 w-28 overflow-hidden rounded-full bg-white">
                        <div className="h-full w-1/2 animate-pulse rounded-full bg-[#5a7d58]" />
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <Button
                        className="w-full bg-[#5a7d58] hover:bg-[#4a6d48]"
                        onClick={() => bookMutation.mutate("stripe_checkout")}
                        disabled={bookMutation.isPending}
                        data-testid="button-confirm-booking"
                      >
                        Continue to secure payment
                      </Button>
                      <div className="rounded-md border border-[#dcae96]/60 bg-[#fff7ed] p-3 text-xs text-[#5f4b3e]" data-testid="hold-appointment-rules">
                        <p className="font-semibold text-[#5f4b3e]">Holding the appointment reserves the slot, but it is not confirmed until payment is received.</p>
                        <p className="mt-1">BFM staff receive a payment alert 72 hours before the appointment. Unpaid or unaccepted holds may auto-cancel 55 hours before the appointment.</p>
                      </div>
                      <Button
                        variant="outline"
                        className="w-full"
                        onClick={() => bookMutation.mutate("hold")}
                        disabled={bookMutation.isPending}
                        data-testid="button-hold-appointment"
                      >
                        Hold appointment
                      </Button>
                      <p className="text-xs text-muted-foreground text-center">
                        Your slot is reserved as a payment hold. It is confirmed only after payment is received; unpaid holds may be cancelled automatically before the appointment.
                      </p>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}
          </>
        )}
      </div>

      <div className="text-center py-8">
        <p className="text-xs text-muted-foreground">
          Brighter Future Mediation Ltd &middot; FMC Accredited &middot; Fully accredited online mediation specialists
        </p>
      </div>
    </div>
  );
}
