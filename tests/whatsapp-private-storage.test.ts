import assert from "node:assert/strict";
import { Readable } from "node:stream";
import test from "node:test";
import { FileStorageService } from "../server/services/file-storage.service";

test("private WhatsApp notes use a private S3 prefix and authenticated application storage key", async () => {
  const previous = {
    driver: process.env.STORAGE_DRIVER,
    bucket: process.env.S3_UPLOAD_BUCKET,
    region: process.env.S3_UPLOAD_REGION,
    prefix: process.env.S3_UPLOAD_PREFIX,
  };
  const sent: Array<{ input: Record<string, unknown> }> = [];
  try {
    process.env.STORAGE_DRIVER = "s3";
    process.env.S3_UPLOAD_BUCKET = "private-bfm-uploads";
    process.env.S3_UPLOAD_REGION = "eu-west-2";
    process.env.S3_UPLOAD_PREFIX = "crm";
    const service = new FileStorageService(() => ({
      async send(command: { input: Record<string, unknown> }) {
        sent.push(command);
        return { Body: Readable.from(Buffer.from("attachment")), ContentType: "image/jpeg" };
      },
    }) as never);

    const stored = await service.savePrivateCaseNoteAttachment({
      fileName: "attachment-id-photo.jpg",
      buffer: Buffer.from([0xff, 0xd8, 0xff]),
      mimeType: "image/jpeg",
    });
    assert.equal(stored.storageKey, "crm/private-case-notes/attachment-id-photo.jpg");
    assert.equal(sent[0].input.Bucket, "private-bfm-uploads");
    assert.equal(sent[0].input.Key, stored.storageKey);
    assert.equal(sent[0].input.ACL, undefined);
    assert.match(stored.fileUrl, /^\/api\/private-case-note-attachments\//);

    const opened = await service.openPrivateCaseNoteAttachment(stored.storageKey);
    assert.equal(sent[1].input.Key, stored.storageKey);
    assert.equal(opened.contentType, "image/jpeg");
  } finally {
    if (previous.driver === undefined) delete process.env.STORAGE_DRIVER; else process.env.STORAGE_DRIVER = previous.driver;
    if (previous.bucket === undefined) delete process.env.S3_UPLOAD_BUCKET; else process.env.S3_UPLOAD_BUCKET = previous.bucket;
    if (previous.region === undefined) delete process.env.S3_UPLOAD_REGION; else process.env.S3_UPLOAD_REGION = previous.region;
    if (previous.prefix === undefined) delete process.env.S3_UPLOAD_PREFIX; else process.env.S3_UPLOAD_PREFIX = previous.prefix;
  }
});
