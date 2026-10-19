import { test } from "node:test";
import assert from "node:assert/strict";
import {
  formatRequestLogLine,
  redactLogMeta,
  summarizeResponseBody,
} from "../server/logger";

test("API response arrays are summarized by count without dumping rows", () => {
  const body = [
    { role: "superadmin", email: "admin@example.com", canView: true },
    { role: "client", email: "client@example.com", canView: false },
  ];

  assert.equal(summarizeResponseBody(body), "result=array count=2");
});

test("paginated response objects summarize totals and item counts only", () => {
  const body = {
    items: [
      { id: "900568ce-5859-4803-83f9-13013019657d", title: "Follow up" },
    ],
    total: 9,
    page: 1,
    pageSize: 5,
  };

  assert.equal(
    summarizeResponseBody(body),
    "result=object items=1 total=9 page=1 pageSize=5",
  );
});

test("response objects summarize message, validation errors and message arrays", () => {
  assert.equal(
    summarizeResponseBody({
      message: "Invalid preview request",
      errors: { senderEmail: ["Invalid email address"] },
    }),
    'result=object message="Invalid preview request" errors=senderEmail',
  );

  assert.equal(
    summarizeResponseBody({
      messages: [{ id: "one" }, { id: "two" }],
    }),
    "result=object messages=2",
  );
});

test("WhatsApp webhook responses summarize processed and status counts", () => {
  assert.equal(
    summarizeResponseBody({
      ok: true,
      processed: [{ messageId: "one" }],
      summary: {
        receivedMessageCount: 1,
        duplicateCount: 0,
        statusUpdateCount: 2,
        processedMessageCount: 1,
      },
    }),
    "result=object processed=1 received=1 duplicates=0 statuses=2",
  );
});

test("auth response summary keeps only short user id and role", () => {
  const body = {
    id: "cadc8290-b68c-429b-8820-e543677ea623",
    email: "rebecca@brighterfuturemediation.co.uk",
    name: "Rebecca Thompson",
    role: "superadmin",
    status: "active",
  };

  assert.equal(
    summarizeResponseBody(body),
    "result=object user=cadc8290 role=superadmin status=active",
  );
});

test("request log line does not include full response bodies by default", () => {
  const line = formatRequestLogLine({
    method: "GET",
    path: "/api/enquiries",
    statusCode: 304,
    durationMs: 46,
    responseBody: {
      data: [
        {
          id: "ae06ebf5-426c-4846-afef-78d83cfd721e",
          email: "hekibigeky@mailinator.com",
          mobileTelephone: "+1 (521) 322-5239",
          addressLine1: "18 Oak Boulevard",
        },
      ],
      total: 2,
      page: 1,
      limit: 20,
    },
  });

  assert.match(line, /^GET \/api\/enquiries 304 46ms /);
  assert.match(line, /result=object data=1 total=2 page=1 limit=20/);
  assert.doesNotMatch(line, /hekibigeky/);
  assert.doesNotMatch(line, /Oak Boulevard/);
  assert.doesNotMatch(line, /mobileTelephone/);
});

test("sensitive log metadata is redacted recursively", () => {
  const redacted = redactLogMeta({
    email: "person@example.com",
    googleRefreshToken: "refresh-token",
    inviteUrl: "https://example.com/invite/secret",
    nested: {
      phone: "+44 123",
      code: "oauth-code",
      id: "a461c7bf-bdc9-4a71-9179-11d37e8d2f3a",
    },
  });

  assert.deepEqual(redacted, {
    email: "[redacted]",
    googleRefreshToken: "[redacted]",
    inviteUrl: "[redacted]",
    nested: {
      phone: "[redacted]",
      code: "[redacted]",
      id: "a461c7bf",
    },
  });
});
