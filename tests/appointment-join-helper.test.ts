/**
 * Regression checks for popup-safe audited appointment joins.
 *
 * Run with: npx tsx tests/appointment-join-helper.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { openAuditedAppointmentJoin } from "../client/src/lib/appointment-join";

test("appointment join opens a blank tab synchronously then navigates it after audit succeeds", async () => {
  const events: string[] = [];
  let openerValue: unknown = {};
  const joinWindow = {
    get opener() {
      return openerValue;
    },
    set opener(value: unknown) {
      openerValue = value;
      events.push(`opener:${String(value)}`);
    },
    location: {
      href: "",
      replace: (url: string) => {
        events.push(`replace:${url}`);
        joinWindow.location.href = url;
      },
    },
    close: () => events.push("close"),
  };

  const result = await openAuditedAppointmentJoin("appt-1", {
    open: (url, target, features) => {
      events.push(`open:${url}:${target}:${features}`);
      return joinWindow as Window;
    },
    request: async (method, url) => {
      events.push(`request:${method}:${url}`);
      return {
        json: async () => ({ meetingLink: "https://zoom.example/j/lead-mediator" }),
      } as Response;
    },
  });

  assert.deepEqual(events, [
    "open:about:blank:_blank:undefined",
    "opener:null",
    "request:POST:/api/appointments/appt-1/join",
    "replace:https://zoom.example/j/lead-mediator",
  ]);
  assert.deepEqual(result, { meetingLink: "https://zoom.example/j/lead-mediator", opened: true });
  assert.equal(joinWindow.location.href, "https://zoom.example/j/lead-mediator");
  assert.equal(openerValue, null);
});

test("appointment join does not redirect the current tab when the pre-opened tab handle is unavailable", async () => {
  const events: string[] = [];

  const result = await openAuditedAppointmentJoin("appt-blank", {
    open: (url, target, features) => {
      events.push(`open:${url}:${target}:${features}`);
      return null;
    },
    request: async (method, url) => {
      events.push(`request:${method}:${url}`);
      return {
        json: async () => ({ meetingLink: "https://zoom.example/j/lead-mediator" }),
      } as Response;
    },
  });

  assert.deepEqual(events, [
    "open:about:blank:_blank:undefined",
    "request:POST:/api/appointments/appt-blank/join",
  ]);
  assert.deepEqual(result, { meetingLink: "https://zoom.example/j/lead-mediator", opened: false });
});

test("appointment join closes the blank tab when the audited join request fails", async () => {
  const events: string[] = [];
  const joinWindow = {
    location: { href: "" },
    close: () => events.push("close"),
  };

  await assert.rejects(
    openAuditedAppointmentJoin("appt-2", {
      open: () => {
        events.push("open");
        return joinWindow as Window;
      },
      request: async () => {
        events.push("request");
        throw new Error("409: Join link is available on the appointment day");
      },
    }),
    /Join link is available on the appointment day/,
  );

  assert.deepEqual(events, ["open", "request", "close"]);
  assert.equal(joinWindow.location.href, "");
});
