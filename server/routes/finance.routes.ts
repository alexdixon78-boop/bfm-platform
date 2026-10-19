import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { requirePermission } from "../middleware/permissions";
import { financeService } from "../services/finance.service";
import { stripePaymentService } from "../services/stripe-payment.service";
import { insertCaseInvoiceSchema, insertCasePaymentSchema, type User } from "@shared/schema";

const router = Router();

function getUser(req: any): User {
  return req.user as User;
}

const requireFinanceView = requirePermission("finance", "view");

function requireClientOrFinanceView(req: any, res: any, next: any) {
  if (req.user?.role === "client") return next();
  return requireFinanceView(req, res, next);
}

router.get("/api/finance/ledger", requirePermission("finance", "view"), async (req, res) => {
  const result = await financeService.listLedger({
    search: typeof req.query.search === "string" ? req.query.search : undefined,
    status: typeof req.query.status === "string" ? req.query.status : undefined,
    paymentStatus: typeof req.query.paymentStatus === "string" ? req.query.paymentStatus : undefined,
    dueFrom: typeof req.query.dueFrom === "string" ? new Date(req.query.dueFrom) : undefined,
    dueTo: typeof req.query.dueTo === "string" ? new Date(req.query.dueTo) : undefined,
    page: Number.parseInt(String(req.query.page || "1"), 10) || 1,
    limit: Number.parseInt(String(req.query.limit || "50"), 10) || 50,
  });
  res.json(result);
});

function requireFinanceStaff(req: any, res: any, next: any) {
  const role = req.user?.role;
  if (role !== "superadmin" && role !== "subadmin") return res.status(403).json({ message: "Finance access denied" });
  next();
}

function htmlEscape(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function normalizeStripeSessionId(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim().replace(/\?+$/, "");
}

router.get("/api/cases/:caseId/finance", requireAuth, requireClientOrFinanceView, async (req, res) => {
  const user = getUser(req);
  const result = await financeService.getCaseFinanceForUser(req.params.caseId, user);
  if (!result.ok) return res.status(result.status).json({ message: result.error });
  res.json(result);
});

router.post("/api/cases/:caseId/invoices", requirePermission("finance", "edit"), async (req, res) => {
  const parsed = insertCaseInvoiceSchema.safeParse({ ...req.body, caseId: req.params.caseId });
  if (!parsed.success) {
    return res.status(400).json({ message: "Invalid invoice data", issues: parsed.error.issues });
  }
  const result = await financeService.createInvoice(parsed.data, getUser(req));
  if (!result.ok) return res.status(result.status).json({ message: result.error });
  res.status(201).json(result.invoice);
});

router.patch("/api/cases/:caseId/invoices/:invoiceId", requirePermission("finance", "edit"), async (req, res) => {
  const parsed = insertCaseInvoiceSchema.partial().safeParse({ ...req.body, caseId: req.params.caseId });
  if (!parsed.success) {
    return res.status(400).json({ message: "Invalid invoice data", issues: parsed.error.issues });
  }
  const result = await financeService.updateInvoice(req.params.invoiceId, parsed.data, getUser(req));
  if (!result.ok) return res.status(result.status).json({ message: result.error });
  res.json(result.invoice);
});

router.delete("/api/cases/:caseId/invoices/:invoiceId", requirePermission("finance", "edit"), async (req, res) => {
  const result = await financeService.voidInvoice(req.params.invoiceId, getUser(req));
  if (!result.ok) return res.status(result.status).json({ message: result.error });
  res.json(result.invoice);
});

router.post("/api/cases/:caseId/payments", requirePermission("finance", "edit"), async (req, res) => {
  const parsed = insertCasePaymentSchema.safeParse({ ...req.body, caseId: req.params.caseId });
  if (!parsed.success) {
    return res.status(400).json({ message: "Invalid payment data", issues: parsed.error.issues });
  }
  const result = await financeService.createPayment(parsed.data, getUser(req));
  if (!result.ok) return res.status(result.status).json({ message: result.error });
  res.status(201).json(result.payment);
});

router.patch("/api/cases/:caseId/payments/:paymentId", requirePermission("finance", "edit"), async (req, res) => {
  const parsed = insertCasePaymentSchema.partial().safeParse({ ...req.body, caseId: req.params.caseId });
  if (!parsed.success) {
    return res.status(400).json({ message: "Invalid payment data", issues: parsed.error.issues });
  }
  const result = await financeService.updatePayment(req.params.paymentId, parsed.data, getUser(req));
  if (!result.ok) return res.status(result.status).json({ message: result.error });
  res.json(result.payment);
});

router.delete("/api/cases/:caseId/payments/:paymentId", requirePermission("finance", "edit"), async (req, res) => {
  const result = await financeService.deletePayment(req.params.paymentId, getUser(req));
  if (!result.ok) return res.status(result.status).json({ message: result.error });
  res.status(204).send();
});

router.post("/api/cases/:caseId/invoices/:invoiceId/retry-payment-link", requireAuth, requireFinanceStaff, async (req, res) => {
  const result = await stripePaymentService.createRetryCheckoutSession(req.params.invoiceId);
  if (!result.ok) return res.status(result.status).json({ message: result.error });
  res.json(result);
});

router.post("/api/finance/invoices/:invoiceId/stripe/reconcile", requirePermission("finance", "edit"), async (req, res) => {
  const result = await stripePaymentService.reconcileStoredInvoiceCheckoutSession(req.params.invoiceId);
  if (!result.ok) return res.status(result.status).json({ message: result.error });
  res.json(result);
});

router.post("/api/client/invoices/:invoiceId/pay", requireAuth, async (req, res) => {
  const user = getUser(req);
  if (user.role !== "client") return res.status(403).json({ message: "Client invoice payment is only available to client users" });
  const result = await stripePaymentService.createMediationSessionInvoiceCheckoutSession(req.params.invoiceId, {
    clientUserId: user.id,
  });
  if (!result.ok) return res.status(result.status).json({ message: result.error });
  res.json(result);
});

router.get("/api/client/invoices/:invoiceId/payment-status", requireAuth, async (req, res) => {
  const user = getUser(req);
  if (user.role !== "client") return res.status(403).json({ message: "Client invoice payment status is only available to client users" });
  const sessionId = normalizeStripeSessionId(req.query.session_id);
  if (!sessionId) return res.status(400).json({ message: "session_id query param is required" });

  const ownedInvoice = await financeService.getMediationSessionInvoiceForCheckout(req.params.invoiceId, {
    clientUserId: user.id,
    allowPaid: true,
  });
  if (!ownedInvoice.ok) return res.status(ownedInvoice.status).json({ message: ownedInvoice.error });

  const result = await stripePaymentService.reconcileInvoiceCheckoutSessionReturn(req.params.invoiceId, sessionId, "return_status_check");
  const latest = await financeService.getMediationSessionInvoiceForCheckout(req.params.invoiceId, {
    clientUserId: user.id,
    allowPaid: true,
  });
  return res.json({
    invoiceId: req.params.invoiceId,
    reconciliationAction: result.action,
    paymentStatus: latest.ok ? latest.invoice.paymentStatus : ownedInvoice.invoice.paymentStatus,
  });
});

router.post("/api/finance/backfill-booking-payments", requireAuth, requireFinanceStaff, async (_req, res) => {
  const result = await financeService.backfillPaidBookingFinance();
  res.json(result);
});

router.get("/api/finance/payments/:paymentId/receipt", requireAuth, requireClientOrFinanceView, async (req, res) => {
  const user = getUser(req);
  const result = await financeService.getPaymentReceipt(req.params.paymentId, user);
  if (!result.ok) return res.status(result.status).json({ message: result.error });
  const p = result.payment;
  const amount = new Intl.NumberFormat("en-GB", { style: "currency", currency: p.currency.toUpperCase() }).format(p.amountPence / 100);
  res.type("html").send(`<!doctype html>
<html><head><meta charset="utf-8"><title>${htmlEscape(p.receiptNumber || "Payment receipt")}</title>
<style>body{font-family:Arial,sans-serif;margin:40px;color:#222}.box{border:1px solid #ddd;padding:24px;max-width:720px}.muted{color:#666}.row{display:flex;justify-content:space-between;border-bottom:1px solid #eee;padding:10px 0}</style></head>
<body><div class="box">
<h1>Payment receipt</h1>
<p class="muted">Brighter Future Mediation</p>
<div class="row"><strong>Receipt</strong><span>${htmlEscape(p.receiptNumber || "")}</span></div>
<div class="row"><strong>Case</strong><span>${htmlEscape(p.caseRef)}</span></div>
<div class="row"><strong>Client</strong><span>${htmlEscape(p.clientName)}</span></div>
<div class="row"><strong>Invoice</strong><span>${htmlEscape(p.invoiceNumber || "Unallocated")}</span></div>
<div class="row"><strong>Service</strong><span>${htmlEscape(p.serviceName || "Case payment")}</span></div>
<div class="row"><strong>Amount</strong><span>${htmlEscape(amount)}</span></div>
<div class="row"><strong>Status</strong><span>${htmlEscape(p.paymentStatus)}</span></div>
<div class="row"><strong>Payment date</strong><span>${htmlEscape(new Date(p.paymentDate).toLocaleDateString("en-GB"))}</span></div>
<div class="row"><strong>Provider reference</strong><span>${htmlEscape(p.providerPaymentId || p.paymentIntentId || p.reference || "")}</span></div>
<script>window.print()</script>
</div></body></html>`);
});

export default router;
