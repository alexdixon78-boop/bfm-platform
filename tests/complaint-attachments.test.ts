import assert from "node:assert/strict";
import test from "node:test";
import { validateComplaintAttachments } from "../server/security/complaint-attachments";

const encode = (bytes: number[]) => Buffer.from(bytes).toString("base64");

test("accepts valid PDF, JPEG, and PNG signatures", () => {
  const result = validateComplaintAttachments([
    { fileName: "evidence.pdf", mimeType: "application/pdf", fileData: encode([0x25, 0x50, 0x44, 0x46, 0x2d]) },
    { fileName: "photo.jpg", mimeType: "image/jpeg", fileData: encode([0xff, 0xd8, 0xff, 0xe0]) },
    { fileName: "screen.png", mimeType: "image/png", fileData: encode([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) },
  ]);
  assert.equal(result.length, 3);
  assert.equal(result[0].sizeBytes, 5);
});

test("rejects extension, MIME, and signature mismatches", () => {
  assert.throws(() => validateComplaintAttachments([
    { fileName: "fake.pdf", mimeType: "application/pdf", fileData: encode([0x89, 0x50, 0x4e, 0x47]) },
  ]), /signature/i);
  assert.throws(() => validateComplaintAttachments([
    { fileName: "wrong.jpg", mimeType: "image/png", fileData: encode([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) },
  ]), /extension/i);
});

test("rejects path traversal, too many files, and total size over 25 MB", () => {
  const pdf = { fileName: "a.pdf", mimeType: "application/pdf" as const, fileData: encode([0x25, 0x50, 0x44, 0x46]) };
  assert.throws(() => validateComplaintAttachments([{ ...pdf, fileName: "../a.pdf" }]), /filename/i);
  assert.throws(() => validateComplaintAttachments(Array(6).fill(pdf)), /five/i);
  const large = Buffer.alloc(9 * 1024 * 1024, 0);
  large.set([0x25, 0x50, 0x44, 0x46]);
  assert.throws(() => validateComplaintAttachments([
    { ...pdf, fileName: "1.pdf", fileData: large.toString("base64") },
    { ...pdf, fileName: "2.pdf", fileData: large.toString("base64") },
    { ...pdf, fileName: "3.pdf", fileData: large.toString("base64") },
  ]), /25 MB/i);
});
