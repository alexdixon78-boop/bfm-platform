/**
 * Focused tests for Gmail MIME body extraction.
 *
 * Run with: npx tsx tests/gmail-message-parser.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseGmailMessageForMailInbox } from "../server/services/gmail-mail.service";

function b64(value: string) {
  return Buffer.from(value, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

const headers = [
  { name: "From", value: '"Jane Person" <jane@example.com>' },
  { name: "To", value: "info@example.com" },
  { name: "Subject", value: "Family mediation enquiry" },
  { name: "Date", value: "Tue, 13 Aug 2024 10:15:00 +0100" },
];

test("parses multipart alternative text and html bodies", () => {
  const parsed = parseGmailMessageForMailInbox({
    id: "msg-1",
    threadId: "thread-1",
    snippet: "Snippet only",
    payload: {
      mimeType: "multipart/alternative",
      headers,
      parts: [
        { mimeType: "text/plain", body: { data: b64("Hello plain body\nSecond line") } },
        { mimeType: "text/html", body: { data: b64("<p>Hello <strong>HTML</strong> body</p>") } },
      ],
    },
  });

  assert.equal(parsed.textBody, "Hello plain body\nSecond line");
  assert.equal(parsed.sanitizedHtmlBody, "<p>Hello <strong>HTML</strong> body</p>");
});

test("finds nested body parts and ignores attachment-like parts", () => {
  const parsed = parseGmailMessageForMailInbox({
    id: "msg-2",
    threadId: "thread-2",
    snippet: "Nested snippet",
    payload: {
      mimeType: "multipart/mixed",
      headers,
      parts: [
        {
          mimeType: "multipart/related",
          parts: [
            {
              mimeType: "multipart/alternative",
              parts: [
                { mimeType: "text/plain", body: { data: b64("Nested readable body") } },
              ],
            },
          ],
        },
        {
          filename: "terms.pdf",
          mimeType: "application/pdf",
          body: { attachmentId: "att-1", data: b64("not email text") },
        },
      ],
    },
  });

  assert.equal(parsed.textBody, "Nested readable body");
  assert.deepEqual(parsed.attachments, [{
    attachmentId: "att-1",
    bodyData: b64("not email text"),
    mimeType: "application/pdf",
    filename: "terms.pdf",
    size: 0,
  }]);
});

test("captures small Gmail attachments whose data is embedded in the MIME part", () => {
  const data = b64("small attachment");
  const parsed = parseGmailMessageForMailInbox({
    id: "msg-small-attachment",
    threadId: "thread-small-attachment",
    payload: {
      mimeType: "multipart/mixed",
      headers,
      parts: [
        { mimeType: "text/plain", body: { data: b64("Reply body") } },
        { filename: "note.txt", mimeType: "text/plain", body: { data, size: 16 } },
      ],
    },
  });

  assert.deepEqual(parsed.attachments, [{
    attachmentId: null,
    bodyData: data,
    mimeType: "text/plain",
    filename: "note.txt",
    size: 16,
  }]);
});

test("uses payload level body data when no child body parts exist", () => {
  const parsed = parseGmailMessageForMailInbox({
    id: "msg-3",
    threadId: "thread-3",
    snippet: "Payload fallback snippet",
    payload: {
      mimeType: "text/plain",
      headers,
      body: { data: b64("Root body text") },
    },
  });

  assert.equal(parsed.textBody, "Root body text");
});

test("html-only messages get readable text fallback and sanitized html", () => {
  const parsed = parseGmailMessageForMailInbox({
    id: "msg-4",
    threadId: "thread-4",
    snippet: "HTML snippet",
    payload: {
      mimeType: "multipart/alternative",
      headers,
      parts: [
        {
          mimeType: "text/html",
          body: {
            data: b64('<div onclick="bad()">Hello <b>HTML only</b><script>alert(1)</script></div>'),
          },
        },
      ],
    },
  });

  assert.equal(parsed.textBody, "Hello HTML only");
  assert.equal(parsed.sanitizedHtmlBody, '<div>Hello <b>HTML only</b></div>');
});

test("removes unquoted event handlers and active SVG content", () => {
  const parsed = parseGmailMessageForMailInbox({
    id: "msg-xss",
    payload: {
      mimeType: "text/html",
      headers,
      body: { data: b64('<img src=x onerror=alert(1)><svg onload=alert(2)><circle></circle></svg><a href="javascript:alert(3)">open</a>') },
    },
  });

  assert.equal(parsed.sanitizedHtmlBody, '<img><a target="_blank" rel="noopener noreferrer">open</a>');
});

test("detects inline cid images and preserves safe cid sources", () => {
  const parsed = parseGmailMessageForMailInbox({
    id: "msg-5",
    threadId: "thread-5",
    snippet: "Inline image snippet",
    payload: {
      mimeType: "multipart/related",
      headers,
      parts: [
        {
          mimeType: "text/html",
          body: {
            data: b64('<p>Hello</p><img src="cid:company-logo" alt="Company logo">'),
          },
        },
        {
          filename: "logo.png",
          mimeType: "image/png",
          headers: [{ name: "Content-ID", value: "<company-logo>" }],
          body: { attachmentId: "att-logo", size: 12 },
        },
      ],
    },
  });

  assert.equal(parsed.sanitizedHtmlBody, '<p>Hello</p><img src="cid:company-logo" alt="Company logo">');
  assert.deepEqual(parsed.inlineImages, [
    {
      contentId: "company-logo",
      attachmentId: "att-logo",
      mimeType: "image/png",
      filename: "logo.png",
      bodyData: null,
      size: 12,
    },
  ]);
});

test("blocks remote image sources while keeping body formatting", () => {
  const parsed = parseGmailMessageForMailInbox({
    id: "msg-6",
    threadId: "thread-6",
    snippet: "Remote image snippet",
    payload: {
      mimeType: "text/html",
      headers,
      body: {
        data: b64('<table><tr><td>Ticket</td></tr></table><img src="https://tracker.example/pixel.png" alt="tracking">'),
      },
    },
  });

  assert.equal(parsed.sanitizedHtmlBody, '<table><tbody><tr><td>Ticket</td></tr></tbody></table><img alt="tracking">');
});
