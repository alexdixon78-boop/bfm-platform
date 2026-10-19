import assert from "node:assert/strict";
import test from "node:test";
import { serviceTypesForRole } from "../server/services/service-type-access";

const serviceType = {
  id: "service-1",
  name: "MIAM",
  description: "Initial assessment",
  category: "MIAM",
  priceInfo: "From £150 per person",
  onlinePaymentEnabled: true,
  paymentAmountPence: 15000,
  paymentCurrency: "gbp",
  isActive: true,
  sortOrder: 1,
  baselineServiceName: "MIAM",
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
};

test("mediator catalogue responses omit all fee and payment configuration", () => {
  const [result] = serviceTypesForRole("mediator", [serviceType]);

  assert.deepEqual(result, {
    id: "service-1",
    name: "MIAM",
    description: "Initial assessment",
    category: "MIAM",
    isActive: true,
    sortOrder: 1,
    baselineServiceName: "MIAM",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
  });
});

test("administrator catalogue responses retain fee and payment configuration", () => {
  const [result] = serviceTypesForRole("superadmin", [serviceType]);

  assert.equal(result.priceInfo, "From £150 per person");
  assert.equal(result.onlinePaymentEnabled, true);
  assert.equal(result.paymentAmountPence, 15000);
  assert.equal(result.paymentCurrency, "gbp");
});
