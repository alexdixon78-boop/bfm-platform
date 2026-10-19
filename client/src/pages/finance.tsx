import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { PoundSterling, Search, ExternalLink } from "lucide-react";
import { CASE_INVOICE_STATUSES, CASE_PAYMENT_STATUSES } from "@shared/schema";

type LedgerInvoice = {
  id: string;
  caseId: string;
  caseRef: string;
  billToClientName: string;
  invoiceNumber: string;
  status: string;
  dueDate: string | Date | null;
  totalPence: number;
  amountPaidPence: number;
  outstandingPence: number;
  currency: string;
  serviceName: string | null;
  provider: string;
  providerInvoiceId: string | null;
  paymentLinkUrl: string | null;
  paymentStatus: string;
  failureReason: string | null;
};

type LedgerResponse = {
  data: LedgerInvoice[];
  total: number;
  page: number;
  limit: number;
};

const PAYMENT_STATUS_LABELS: Record<string, string> = {
  unpaid: "Unpaid",
  paid: "Paid",
  failed: "Failed",
  cancelled: "Cancelled",
  expired: "Expired",
  refunded: "Refunded",
};

const STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  issued: "Issued",
  part_paid: "Part paid",
  paid: "Paid",
  overdue: "Overdue",
  void: "Void",
};

function formatPence(amountPence?: number | null, currency = "gbp"): string {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: (currency || "gbp").toUpperCase(),
  }).format((amountPence || 0) / 100);
}

export default function FinancePage() {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("__all");
  const [paymentStatus, setPaymentStatus] = useState("__all");
  const [dueFrom, setDueFrom] = useState("");
  const [dueTo, setDueTo] = useState("");

  const query = new URLSearchParams();
  if (search.trim()) query.set("search", search.trim());
  if (status !== "__all") query.set("status", status);
  if (paymentStatus !== "__all") query.set("paymentStatus", paymentStatus);
  if (dueFrom) query.set("dueFrom", dueFrom);
  if (dueTo) query.set("dueTo", dueTo);

  const { data, isLoading } = useQuery<LedgerResponse>({
    queryKey: ["/api/finance/ledger", search, status, paymentStatus, dueFrom, dueTo],
    queryFn: async () => {
      const res = await fetch(`/api/finance/ledger?${query.toString()}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load finance ledger");
      return res.json();
    },
  });

  const totals = (data?.data || []).reduce((acc, invoice) => {
    if (invoice.status !== "void") {
      acc.invoiced += invoice.totalPence;
      acc.paid += invoice.amountPaidPence;
      acc.outstanding += invoice.outstandingPence;
    }
    return acc;
  }, { invoiced: 0, paid: 0, outstanding: 0 });

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-heading font-semibold flex items-center gap-2">
            <PoundSterling className="w-6 h-6 text-[#5a7d58]" />
            Finance
          </h1>
          <p className="text-sm text-muted-foreground">Case-wise CRM invoices and client payment records.</p>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Invoiced</p><p className="text-xl font-semibold">{formatPence(totals.invoiced)}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Paid</p><p className="text-xl font-semibold">{formatPence(totals.paid)}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Outstanding</p><p className="text-xl font-semibold">{formatPence(totals.outstanding)}</p></CardContent></Card>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <CardTitle className="text-base font-heading">Invoice ledger</CardTitle>
            <div className="flex items-center gap-2 flex-wrap">
              <div className="relative">
                <Search className="w-4 h-4 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input className="pl-8 w-64" placeholder="Search case, client, invoice" value={search} onChange={(e) => setSearch(e.target.value)} data-testid="input-finance-search" />
              </div>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger className="w-40" data-testid="select-finance-status"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all">All statuses</SelectItem>
                  {CASE_INVOICE_STATUSES.map((item) => <SelectItem key={item} value={item}>{STATUS_LABELS[item]}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={paymentStatus} onValueChange={setPaymentStatus}>
                <SelectTrigger className="w-44" data-testid="select-finance-payment-status"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all">All payment states</SelectItem>
                  {CASE_PAYMENT_STATUSES.map((item) => <SelectItem key={item} value={item}>{PAYMENT_STATUS_LABELS[item]}</SelectItem>)}
                </SelectContent>
              </Select>
              <Input type="date" className="w-36" value={dueFrom} onChange={(e) => setDueFrom(e.target.value)} data-testid="input-finance-due-from" />
              <Input type="date" className="w-36" value={dueTo} onChange={(e) => setDueTo(e.target.value)} data-testid="input-finance-due-to" />
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {isLoading ? (
            <>
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
            </>
          ) : data?.data.length === 0 ? (
            <div className="text-sm text-muted-foreground text-center py-12">No internal invoices match these filters.</div>
          ) : data?.data.map((invoice) => (
            <div key={invoice.id} className="border rounded-md p-3 flex items-start justify-between gap-3 flex-wrap" data-testid="finance-ledger-row">
              <div className="min-w-0">
                <p className="text-sm font-semibold">{invoice.billToClientName}</p>
                <p className="text-xs text-muted-foreground">
                  {invoice.invoiceNumber} · {invoice.caseRef}{invoice.serviceName ? ` · ${invoice.serviceName}` : ""}
                </p>
                <p className="text-xs text-muted-foreground">
                  Due {invoice.dueDate ? new Date(invoice.dueDate).toLocaleDateString("en-GB") : "not set"} · Paid {formatPence(invoice.amountPaidPence, invoice.currency)} · Outstanding {formatPence(invoice.outstandingPence, invoice.currency)}
                </p>
                <p className="text-xs text-muted-foreground">
                  {invoice.provider !== "manual" ? `${invoice.provider} · ` : ""}{invoice.providerInvoiceId ? `Provider invoice ${invoice.providerInvoiceId}` : "CRM invoice"}{invoice.failureReason ? ` · ${invoice.failureReason}` : ""}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant={invoice.status === "overdue" ? "destructive" : "outline"}>{STATUS_LABELS[invoice.status] || invoice.status}</Badge>
                <Badge variant={invoice.paymentStatus === "paid" ? "default" : invoice.paymentStatus === "failed" || invoice.paymentStatus === "expired" ? "destructive" : "outline"}>{PAYMENT_STATUS_LABELS[invoice.paymentStatus] || invoice.paymentStatus}</Badge>
                {invoice.paymentLinkUrl && invoice.paymentStatus !== "paid" && (
                  <Button size="sm" variant="outline" onClick={() => window.open(invoice.paymentLinkUrl!, "_blank", "noopener,noreferrer")} data-testid="button-finance-payment-link">
                    <ExternalLink className="w-3.5 h-3.5 mr-1" />
                    Pay
                  </Button>
                )}
                <Button size="sm" variant="outline" asChild data-testid="link-finance-case">
                  <Link href={`/cases/${invoice.caseId}?tab=payments`}>
                    <ExternalLink className="w-3.5 h-3.5 mr-1" />
                    Case
                  </Link>
                </Button>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
