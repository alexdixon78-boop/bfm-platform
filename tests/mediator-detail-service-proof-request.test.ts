/**
 * Regression checks for admin service-proof requests from live mediator detail.
 *
 * Run with: npx tsx tests/mediator-detail-service-proof-request.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function read(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

const routeSource = read("../server/routes/mediator-profile.routes.ts");
const serviceSource = read("../server/services/mediator-service-approval.service.ts");
const detailSource = read("../client/src/pages/mediator-detail.tsx");
const docsSource = read("../replit.md");

test("live mediator profile exposes a staff-only service-proof request endpoint", () => {
  assert.match(routeSource, /\/api\/mediators\/:id\/service-approvals\/:serviceTypeId\/request/);
  assert.match(routeSource, /requestForMediator/);
  assert.match(routeSource, /sendMediatorServiceProofRequestEmail/);
});

test("service layer supports mediator-scoped requests separate from applicant requests", () => {
  assert.match(serviceSource, /async requestForMediator/);
  assert.match(serviceSource, /recipientRole:\s*"mediator"/);
  assert.match(serviceSource, /type:\s*"service_proof_requested"/);
  assert.match(serviceSource, /action:\s*"request_service_proof"/);
});

test("mediator detail renders admin request action only for missing rejected or expired services", () => {
  assert.match(detailSource, /requestServiceProof/);
  assert.match(detailSource, /canRequestProof/);
  assert.match(detailSource, /!approval \|\| displayStatus === "rejected" \|\| displayStatus === "expired"/);
  assert.match(detailSource, /data-testid=\{`button-request-service-proof-\$\{service\.id\}`\}/);
  assert.match(detailSource, /\/api\/mediators\/\$\{id\}\/service-approvals\/\$\{serviceTypeId\}\/request/);
  assert.match(detailSource, /invalidateQueries\(\{ queryKey: \["\/api\/mediators", id, "service-approvals"\] \}\)/);
});

test("replit documents admin live-mediator proof requests", () => {
  assert.match(docsSource, /live mediator detail/i);
  assert.match(docsSource, /admin proof requests/i);
  assert.match(docsSource, /in-app \+ email/i);
});
