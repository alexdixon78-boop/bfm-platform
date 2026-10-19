import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Router } from "wouter";
import { MediatorDetailsButton } from "../client/src/components/mediator/mediator-details-button";
import {
  getMediatorDetailBackNavigation,
  getMediatorDetailsPath,
} from "../shared/mediator-profile-navigation";

test("mediator account management opens the signed-in mediator detail record", () => {
  assert.equal(
    getMediatorDetailsPath({ role: "mediator", id: "9960fcd8-4841-4ede-920e-799bf3bba3d0" }),
    "/mediators/9960fcd8-4841-4ede-920e-799bf3bba3d0",
  );
});

test("mediator account management renders a button-style link to the mediator record", () => {
  const markup = renderToStaticMarkup(createElement(
    Router,
    { ssrPath: "/" },
    createElement(MediatorDetailsButton, {
      mediatorId: "9960fcd8-4841-4ede-920e-799bf3bba3d0",
    }),
  ));

  assert.match(markup, /href="\/mediators\/9960fcd8-4841-4ede-920e-799bf3bba3d0"/);
  assert.match(markup, />Manage mediator details<\/a>/);
  assert.match(markup, /inline-flex/);
});

test("mediator detail back navigation returns mediators to My Profile", () => {
  assert.deepEqual(getMediatorDetailBackNavigation("mediator"), {
    href: "/my-profile",
    label: "My profile",
  });
});

test("mediator detail back navigation retains the directory destination for staff", () => {
  assert.deepEqual(getMediatorDetailBackNavigation("superadmin"), {
    href: "/mediators",
    label: "Mediators",
  });
});
