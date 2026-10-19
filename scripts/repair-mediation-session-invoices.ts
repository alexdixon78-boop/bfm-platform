/**
 * One-time repair for existing mediation sessions whose proposal was accepted
 * before per-session invoice reuse was scoped correctly.
 *
 * Run:
 *   npx tsx scripts/repair-mediation-session-invoices.ts --case-id <caseId> --session-number <number>
 *   npx tsx scripts/repair-mediation-session-invoices.ts --case-id <caseId> --session-number <number> --dry-run
 */
import "dotenv/config";
import { loadRuntimeEnv } from "../server/config/runtime-env";
import type { User } from "@shared/schema";

type Args = {
  caseId: string;
  sessionNumber: number;
  dryRun: boolean;
};

type Actor = Pick<User, "id" | "name" | "role">;
type Storage = typeof import("../server/storage").storage;

function parseArgs(argv: string[]): Args {
  let caseId = "";
  let sessionNumber = 2;
  let dryRun = false;

  for (let i = 0; i < argv.length; i++) {
    const current = argv[i];
    if (current === "--dry-run") {
      dryRun = true;
      continue;
    }
    if (current === "--case-id") {
      caseId = argv[++i] || "";
      continue;
    }
    if (current === "--session-number") {
      sessionNumber = Number.parseInt(argv[++i] || "", 10);
      continue;
    }
    throw new Error(`Unknown argument: ${current}`);
  }

  if (!caseId) throw new Error("Missing required --case-id");
  if (!Number.isInteger(sessionNumber) || sessionNumber <= 0) {
    throw new Error("--session-number must be a positive integer");
  }

  return { caseId, sessionNumber, dryRun };
}

async function getRepairActor(storage: Storage): Promise<Actor> {
  const users = await storage.listUsers();
  const actor = users.find((user) => user.role === "superadmin" && user.status !== "archived")
    || users.find((user) => user.role === "subadmin" && user.status !== "archived");
  if (!actor) throw new Error("No active superadmin/subadmin user found for invoice audit fields");
  return { id: actor.id, name: actor.name, role: actor.role };
}

async function main() {
  const { caseId, sessionNumber, dryRun } = parseArgs(process.argv.slice(2));
  await loadRuntimeEnv();
  const { financeService } = await import("../server/services/finance.service");
  const { storage } = await import("../server/storage");
  const { pool } = await import("../server/db");

  try {
    const existingCase = await storage.getCase(caseId);
    if (!existingCase) throw new Error(`Case not found: ${caseId}`);

    const sessions = await storage.listMediationSessionsByCase(caseId);
    const session = sessions.find((session) => session.sessionNumber === sessionNumber);
    if (!session) throw new Error(`Mediation Session ${sessionNumber} not found for case ${caseId}`);
    if (!session.appointmentId) {
      throw new Error(`Mediation Session ${sessionNumber} has no appointment; propose/hold a slot before repairing invoices`);
    }

    const appointment = await storage.getAppointment(session.appointmentId);
    if (!appointment) throw new Error(`Linked appointment not found: ${session.appointmentId}`);

    const serviceType = (await storage.listServiceTypes()).find((service) => service.name === "Mediation Sessions" && service.isActive);
    if (!serviceType || !serviceType.onlinePaymentEnabled || !serviceType.paymentAmountPence || serviceType.paymentAmountPence <= 0) {
      throw new Error("Mediation Sessions service type must have online payment enabled and a positive amount");
    }

    const parties = await storage.listPartiesByCase(caseId);
    const existingInvoices = await financeService.listInvoicesByAppointment(appointment.id);
    const nonVoidExistingInvoices = existingInvoices.filter((invoice) => invoice.status !== "void");
    const existingPartyIds = new Set(nonVoidExistingInvoices.filter((invoice) => invoice.billToPartyId).map((invoice) => invoice.billToPartyId));
    const voidOnlyPartyIds = new Set(existingInvoices.filter((invoice) => invoice.status === "void" && invoice.billToPartyId).map((invoice) => invoice.billToPartyId));
    const missingParties = parties.filter((party) => !existingPartyIds.has(party.id));

    console.log(`[repair] case=${existingCase.caseRef} (${caseId})`);
    console.log(`[repair] mediationSession=Session ${session.sessionNumber} (${session.id})`);
    console.log(`[repair] appointment=${appointment.id}`);
    console.log(`[repair] existingInvoices=${nonVoidExistingInvoices.length}`);
    console.log(`[repair] voidInvoiceConflicts=${missingParties.filter((party) => voidOnlyPartyIds.has(party.id)).length}`);
    console.log(`[repair] missingPartyInvoices=${missingParties.length}`);

    if (dryRun) {
      console.log("[repair] dry-run: no invoices created");
      for (const invoice of nonVoidExistingInvoices) {
        console.log(`[repair] existing invoice ${invoice.invoiceNumber} party=${invoice.billToPartyId || "none"} status=${invoice.status} payment=${invoice.paymentStatus}`);
      }
      for (const party of missingParties) {
        const reason = voidOnlyPartyIds.has(party.id)
          ? "void invoice already exists for this appointment; inspect before repair"
          : "missing current-session invoice";
        console.log(`[repair] would create invoice for party=${party.id} client=${party.clientId} reason=${reason}`);
      }
      console.log("[repair] Accepted proposal responses are unchanged.");
      console.log("[repair] Next client payment action: clients can use their dashboard payment prompt or session response payment retry.");
      return;
    }

    const actor = await getRepairActor(storage);
    const result = await financeService.ensureMediationSessionInvoices({
      appointment,
      serviceType,
      parties,
      actor,
      reusableAppointmentIds: [],
    });
    if (!result.ok) throw new Error(result.error);

    const repairedInvoices = await financeService.listInvoicesByAppointment(appointment.id);
    const createdInvoices = repairedInvoices.filter((invoice) => !existingInvoices.some((existing) => existing.id === invoice.id));
    const repairedPartyIds = new Set(repairedInvoices.filter((invoice) => invoice.status !== "void" && invoice.billToPartyId).map((invoice) => invoice.billToPartyId));
    const skippedParties = parties.filter((party) => existingPartyIds.has(party.id));
    const unresolvedParties = parties.filter((party) => !repairedPartyIds.has(party.id));

    console.log(`[repair] createdInvoices=${createdInvoices.length}`);
    for (const invoice of createdInvoices) {
      console.log(`[repair] created invoice ${invoice.invoiceNumber} party=${invoice.billToPartyId || "none"} outstanding=${invoice.outstandingPence} ${invoice.currency}`);
    }
    console.log(`[repair] skippedParties=${skippedParties.length}`);
    for (const party of skippedParties) {
      console.log(`[repair] skipped party=${party.id} client=${party.clientId} reason=invoice already exists`);
    }
    if (unresolvedParties.length > 0) {
      console.log(`[repair] unresolvedParties=${unresolvedParties.length}`);
      for (const party of unresolvedParties) {
        console.log(`[repair] unresolved party=${party.id} client=${party.clientId} reason=no non-void invoice exists after repair`);
      }
    }
    console.log("[repair] Accepted proposal responses are unchanged.");
    console.log("[repair] Next client payment action: clients can use their dashboard payment prompt or session response payment retry.");
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error("[repair] failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
