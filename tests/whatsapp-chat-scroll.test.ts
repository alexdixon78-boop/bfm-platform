import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const workspace = readFileSync(
  new URL("../client/src/components/whatsapp/whatsapp-chat-workspace.tsx", import.meta.url),
  "utf8",
);

test("WhatsApp chat workspace anchors the newest message after message changes", () => {
  assert.match(workspace, /useLayoutEffect/);
  assert.match(workspace, /useRef/);
  assert.match(workspace, /latestMessageScrollKey/);
  assert.match(workspace, /whatsapp-chat-bottom-anchor/);
  assert.match(workspace, /scrollIntoView\(\{ block: "end" \}\)/);
});
