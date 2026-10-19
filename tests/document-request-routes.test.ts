import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const routePath = new URL("../server/routes/document-request.routes.ts", import.meta.url);
const routes = existsSync(routePath) ? readFileSync(routePath, "utf8") : "";
const routeIndex = readFileSync(new URL("../server/routes/index.ts", import.meta.url), "utf8");

test("authenticated document-request endpoints expose every approved lifecycle action", () => {
  for (const endpoint of [
    'router.get("/api/cases/:caseId/document-requests"',
    'router.post("/api/cases/:caseId/document-requests"',
    'router.post("/api/document-requests/:id/submit"',
    'router.post("/api/document-requests/:id/resend"',
    'router.post("/api/document-requests/:id/return"',
    'router.post("/api/document-requests/:id/complete"',
    'router.post("/api/document-requests/:id/cancel"',
  ]) assert.ok(routes.includes(endpoint), `missing endpoint ${endpoint}`);
  assert.match(routes, /requirePermission\("cases", "view"\)/);
  assert.match(routeIndex, /documentRequestRoutes/);
  assert.match(routeIndex, /app\.use\(documentRequestRoutes\)/);
});

test("document-request payloads validate catalogue, recipients, return reason, and one upload", () => {
  assert.match(routes, /z\.enum\(DOCUMENT_REQUEST_TYPES\)/);
  assert.match(routes, /partyIds: z\.array\(z\.string\(\)\.trim\(\)\.min\(1\)\)\.min\(1\)/);
  assert.match(routes, /customDocumentName: z\.string\(\)\.trim\(\)\.max\(200\)\.optional\(\)\.nullable\(\)/);
  assert.match(routes, /reason: z\.string\(\)\.trim\(\)\.min\(1\)/);
  assert.match(routes, /fileData: z\.string\(\)\.trim\(\)\.min\(1\)/);
});
