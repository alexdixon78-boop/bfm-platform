import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const layout = readFileSync(
  new URL(
    "../client/src/components/layout/dashboard-layout.tsx",
    import.meta.url,
  ),
  "utf8",
);
const page = readFileSync(
  new URL("../client/src/pages/clients.tsx", import.meta.url),
  "utf8",
);

test("staff client list routes to a dedicated client detail page", () => {
  assert.match(layout, /path="\/clients\/:id"/i);
  assert.match(
    page,
    /navigate\(`\/clients\/\$\{.*?\}`\)|navigate\("\/clients\/\$\{.*?\}"\)/i,
  );
});
