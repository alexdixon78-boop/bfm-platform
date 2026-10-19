import "dotenv/config";
import { db, pool } from "./db";
import { users, permissions, serviceTypes, serviceTypeDeletions } from "@shared/schema";
import { eq, or } from "drizzle-orm";
import { scryptSync, randomBytes } from "crypto";
import { DEFAULT_PERMISSIONS } from "@shared/permissions";

const BOOTSTRAP_SUPERADMIN = {
  email: "rebecca@brighterfuturemediation.co.uk",
  password: "admin123",
  name: "Rebecca Thompson",
  role: "superadmin",
} as const;

const BASELINE_SERVICE_TYPES = [
  { name: "MIAM", description: "Mediation Information and Assessment Meeting - required before making a court application for most family disputes", category: "MIAM", priceInfo: "From £150 per person", onlinePaymentEnabled: true, paymentAmountPence: 15000, paymentCurrency: "gbp", sortOrder: 1 },
  { name: "Urgent (Same Day) MIAM", description: "Same-day Mediation Information and Assessment Meeting for urgent court deadlines", category: "MIAM", priceInfo: "From £200 per person", onlinePaymentEnabled: true, paymentAmountPence: 20000, paymentCurrency: "gbp", sortOrder: 2 },
  { name: "Evening/weekend MIAM", description: "Mediation Information and Assessment Meeting outside standard weekday hours", category: "MIAM", priceInfo: "Contact for pricing", onlinePaymentEnabled: false, paymentAmountPence: null, paymentCurrency: "gbp", sortOrder: 3 },
  { name: "Mediation Sessions", description: "Joint mediation sessions to resolve family disputes including child arrangements and financial matters", category: "Mediation", priceInfo: "From £300 per session", onlinePaymentEnabled: false, paymentAmountPence: null, paymentCurrency: "gbp", sortOrder: 4 },
  { name: "Child Inclusive Mediation (CIM)", description: "Specialist mediation that gives children a voice in the mediation process through a trained mediator", category: "Mediation", priceInfo: "Contact for pricing", onlinePaymentEnabled: false, paymentAmountPence: null, paymentCurrency: "gbp", sortOrder: 5 },
  { name: "Mediation Child only", description: "Mediation focused on child arrangements and parenting matters", category: "Mediation", priceInfo: "Contact for pricing", onlinePaymentEnabled: false, paymentAmountPence: null, paymentCurrency: "gbp", sortOrder: 6 },
  { name: "Mediation AIM", description: "All Issues Mediation covering child arrangements and property and finance matters", category: "Mediation", priceInfo: "Contact for pricing", onlinePaymentEnabled: false, paymentAmountPence: null, paymentCurrency: "gbp", sortOrder: 7 },
  { name: "Mediation P&F", description: "Mediation focused on property and financial matters", category: "Mediation", priceInfo: "Contact for pricing", onlinePaymentEnabled: false, paymentAmountPence: null, paymentCurrency: "gbp", sortOrder: 8 },
  { name: "Child Inclusive Parent Prep session", description: "Parent preparation session before child inclusive mediation", category: "Mediation", priceInfo: "Contact for pricing", onlinePaymentEnabled: false, paymentAmountPence: null, paymentCurrency: "gbp", sortOrder: 9 },
  { name: "Child Inclusive Mediation session", description: "Child inclusive mediation session with a trained mediator", category: "Mediation", priceInfo: "Contact for pricing", onlinePaymentEnabled: false, paymentAmountPence: null, paymentCurrency: "gbp", sortOrder: 10 },
  { name: "Court Application Package (C100)", description: "Complete C100 court application package for child arrangement orders", category: "Court & Documentation", priceInfo: "From £500", onlinePaymentEnabled: false, paymentAmountPence: null, paymentCurrency: "gbp", sortOrder: 6 },
  { name: "Court Application Package (Form A)", description: "Complete Form A court application package for financial remedy orders", category: "Court & Documentation", priceInfo: "From £500", onlinePaymentEnabled: false, paymentAmountPence: null, paymentCurrency: "gbp", sortOrder: 7 },
  { name: "Direct to Court Express", description: "Expedited court application service for urgent matters", category: "Court & Documentation", priceInfo: "Contact for pricing", onlinePaymentEnabled: false, paymentAmountPence: null, paymentCurrency: "gbp", sortOrder: 8 },
  { name: "Memorandum of Understanding (MOU)", description: "Formal written record of agreements reached during mediation", category: "Court & Documentation", priceInfo: "From £250", onlinePaymentEnabled: false, paymentAmountPence: null, paymentCurrency: "gbp", sortOrder: 9 },
  { name: "Statement of Child Arrangements", description: "Documented statement outlining agreed child arrangements from mediation", category: "Court & Documentation", priceInfo: "From £200", onlinePaymentEnabled: false, paymentAmountPence: null, paymentCurrency: "gbp", sortOrder: 10 },
  { name: "Open Financial Statement (OFS)", description: "Formal statement recording the financial information disclosed during mediation", category: "Court & Documentation", priceInfo: "Contact for pricing", onlinePaymentEnabled: false, paymentAmountPence: null, paymentCurrency: "gbp", sortOrder: 11 },
  { name: "Fixed Fee Divorce & Separation Package", description: "All-inclusive fixed fee package covering mediation for divorce and separation matters", category: "Packages", priceInfo: "Contact for pricing", onlinePaymentEnabled: false, paymentAmountPence: null, paymentCurrency: "gbp", sortOrder: 12 },
  { name: "Consent Order Essential Package", description: "Essential support to prepare a consent order from a mediated agreement", category: "Packages", priceInfo: "Contact for pricing", onlinePaymentEnabled: false, paymentAmountPence: null, paymentCurrency: "gbp", sortOrder: 13 },
  { name: "Consent Order Supported Package", description: "Supported consent order package with additional guidance through the process", category: "Packages", priceInfo: "Contact for pricing", onlinePaymentEnabled: false, paymentAmountPence: null, paymentCurrency: "gbp", sortOrder: 14 },
] as const;

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

export async function seedDatabase() {
  await seedBootstrapSuperadmin();
  await seedDefaultPermissions();
  await seedServiceTypes();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  seedDatabase()
    .then(async () => {
      console.log("Database seed completed");
      await pool.end();
    })
    .catch(async (err) => {
      console.error("Database seed failed", err);
      await pool.end().catch(() => undefined);
      process.exit(1);
    });
}

async function seedBootstrapSuperadmin() {
  const existing = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, BOOTSTRAP_SUPERADMIN.email));

  if (existing.length > 0) return;

  await db.insert(users).values({
    email: BOOTSTRAP_SUPERADMIN.email,
    password: hashPassword(BOOTSTRAP_SUPERADMIN.password),
    name: BOOTSTRAP_SUPERADMIN.name,
    role: BOOTSTRAP_SUPERADMIN.role,
  });
  console.log("Seeded bootstrap superadmin user");
}

async function seedDefaultPermissions() {
  const inserted = await db
    .insert(permissions)
    .values(DEFAULT_PERMISSIONS)
    .onConflictDoNothing({ target: [permissions.role, permissions.section] })
    .returning({ id: permissions.id });

  if (inserted.length > 0) {
    console.log(`Seeded ${inserted.length} default permission(s)`);
  }
}

async function seedServiceTypes() {
  let inserted = 0;

  for (const serviceType of BASELINE_SERVICE_TYPES) {
    const existing = await db
      .select({ id: serviceTypes.id })
      .from(serviceTypes)
      .where(or(eq(serviceTypes.name, serviceType.name), eq(serviceTypes.baselineServiceName, serviceType.name)));

    if (existing.length > 0) continue;

    const [deleted] = await db
      .select({ name: serviceTypeDeletions.name })
      .from(serviceTypeDeletions)
      .where(eq(serviceTypeDeletions.name, serviceType.name));
    if (deleted) continue;

    await db.insert(serviceTypes).values({ ...serviceType, baselineServiceName: serviceType.name });
    inserted++;
  }

  if (inserted > 0) {
    console.log(`Seeded ${inserted} service type(s)`);
  }
}
