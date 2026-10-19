import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { FileStorageService } from "../server/services/file-storage.service";

test("local profile image storage saves and serves the uploaded bytes", async () => {
  const root = await mkdtemp(join(tmpdir(), "bfm-profile-image-"));
  const previous = process.cwd();
  const previousDriver = process.env.STORAGE_DRIVER;
  try {
    process.chdir(root);
    process.env.STORAGE_DRIVER = "local";
    const service = new FileStorageService();
    const bytes = Buffer.from("profile-image");
    const stored = await service.saveProfileImage({ fileName: "00000000-0000-0000-0000-000000000001.png", buffer: bytes, mimeType: "image/png" });
    assert.equal(stored.fileUrl, "/uploads/profile-images/00000000-0000-0000-0000-000000000001.png");
    assert.deepEqual(await readFile(stored.storageKey), bytes);
    const opened = await service.getProfileImage("00000000-0000-0000-0000-000000000001.png");
    const chunks: Buffer[] = [];
    for await (const chunk of opened.body) chunks.push(Buffer.from(chunk));
    assert.deepEqual(Buffer.concat(chunks), bytes);
  } finally {
    process.chdir(previous);
    if (previousDriver === undefined) delete process.env.STORAGE_DRIVER; else process.env.STORAGE_DRIVER = previousDriver;
    await rm(root, { recursive: true, force: true });
  }
});

test("S3 profile image storage uses the private configured bucket and prefix", async () => {
  const previous = { driver: process.env.STORAGE_DRIVER, bucket: process.env.S3_UPLOAD_BUCKET, region: process.env.S3_UPLOAD_REGION, prefix: process.env.S3_UPLOAD_PREFIX };
  const sent: Array<{ input: Record<string, unknown> }> = [];
  try {
    process.env.STORAGE_DRIVER = "s3";
    process.env.S3_UPLOAD_BUCKET = "private-bfm-uploads";
    process.env.S3_UPLOAD_REGION = "eu-west-2";
    process.env.S3_UPLOAD_PREFIX = "crm";
    const service = new FileStorageService(() => ({ async send(command: { input: Record<string, unknown> }) { sent.push(command); return { Body: Readable.from(Buffer.from("image")), ContentType: "image/png" }; } }) as never);
    const stored = await service.saveProfileImage({ fileName: "00000000-0000-0000-0000-000000000002.png", buffer: Buffer.from("image"), mimeType: "image/png" });
    assert.equal(stored.storageKey, "crm/profile-images/00000000-0000-0000-0000-000000000002.png");
    assert.equal(sent[0].input.Bucket, "private-bfm-uploads");
    assert.equal(sent[0].input.ContentType, "image/png");
    const opened = await service.getProfileImage("00000000-0000-0000-0000-000000000002.png");
    assert.equal(sent[1].input.Key, stored.storageKey);
    assert.equal(opened.contentType, "image/png");
  } finally {
    if (previous.driver === undefined) delete process.env.STORAGE_DRIVER; else process.env.STORAGE_DRIVER = previous.driver;
    if (previous.bucket === undefined) delete process.env.S3_UPLOAD_BUCKET; else process.env.S3_UPLOAD_BUCKET = previous.bucket;
    if (previous.region === undefined) delete process.env.S3_UPLOAD_REGION; else process.env.S3_UPLOAD_REGION = previous.region;
    if (previous.prefix === undefined) delete process.env.S3_UPLOAD_PREFIX; else process.env.S3_UPLOAD_PREFIX = previous.prefix;
  }
});
