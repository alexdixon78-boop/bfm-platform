import fs from "fs/promises";
import { createReadStream } from "fs";
import path from "path";
import { Readable } from "stream";
import {
  GetObjectCommand,
  PutObjectCommand,
  DeleteObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getAwsClientConfig } from "../config/runtime-env";

const SERVICE_APPROVAL_ROUTE_PREFIX = "/uploads/mediator-service-approvals";
const CASE_DOCUMENT_ROUTE_PREFIX = "/uploads/case-documents";
const COURT_FORM_TEMPLATE_ROUTE_PREFIX = "/uploads/court-form-templates";
const COMPLAINT_ATTACHMENT_ROUTE_PREFIX = "/uploads/complaint-attachments";
const PROFILE_IMAGE_ROUTE_PREFIX = "/uploads/profile-images";
const LOCAL_UPLOAD_ROOT = path.join(process.cwd(), "uploads");
const LOCAL_PRIVATE_UPLOAD_ROOT = path.join(process.cwd(), "private-uploads");
const LOCAL_SERVICE_APPROVAL_DIR = path.join(
  LOCAL_UPLOAD_ROOT,
  "mediator-service-approvals",
);
const LOCAL_CASE_DOCUMENT_DIR = path.join(LOCAL_UPLOAD_ROOT, "case-documents");
const LOCAL_COURT_FORM_TEMPLATE_DIR = path.join(LOCAL_UPLOAD_ROOT, "court-form-templates");
const LOCAL_COMPLAINT_ATTACHMENT_DIR = path.join(LOCAL_PRIVATE_UPLOAD_ROOT, "complaint-attachments");
const LOCAL_PRIVATE_CASE_NOTE_DIR = path.join(LOCAL_PRIVATE_UPLOAD_ROOT, "private-case-notes");
const LOCAL_WHATSAPP_OUTBOUND_DIR = path.join(LOCAL_PRIVATE_UPLOAD_ROOT, "whatsapp-outbound");
function localProfileImageDir() { return path.join(process.cwd(), "uploads", "profile-images"); }

type StorageDriver = "local" | "s3";

export type StoredFile = {
  fileUrl: string;
  storageKey: string;
};

export type DownloadedFile = {
  body: Readable;
  contentType?: string;
  contentLength?: number;
};

function getStorageDriver(): StorageDriver {
  return process.env.STORAGE_DRIVER === "s3" ? "s3" : "local";
}

function getS3Prefix(folder = "mediator-service-approvals"): string {
  return (process.env.S3_UPLOAD_PREFIX || "mediator-service-approvals")
    .replace(/^\/+|\/+$/g, "");
}

function getS3Config(folder = "mediator-service-approvals") {
  const bucket = process.env.S3_UPLOAD_BUCKET;
  const region = process.env.S3_UPLOAD_REGION || process.env.AWS_REGION;
  if (!bucket || !region) {
    throw new Error(
      "S3 upload storage requires S3_UPLOAD_BUCKET and S3_UPLOAD_REGION or AWS_REGION",
    );
  }
  const rootPrefix = getS3Prefix(folder);
  const prefix = rootPrefix === folder ? rootPrefix : `${rootPrefix}/${folder}`;
  return { bucket, region, prefix };
}

function getServerSideEncryption(): "AES256" | "aws:kms" | undefined {
  const value = process.env.S3_UPLOAD_SSE;
  if (value === "AES256" || value === "aws:kms") return value;
  return undefined;
}

function objectKeyForFileName(fileName: string, folder = "mediator-service-approvals"): string {
  const { prefix } = getS3Config(folder);
  return prefix ? `${prefix}/${fileName}` : fileName;
}

function fileNameFromObjectKey(key: string): string {
  return path.posix.basename(key);
}

async function toReadable(body: unknown): Promise<Readable> {
  if (body instanceof Readable) return body;
  if (body && typeof (body as { transformToByteArray?: unknown }).transformToByteArray === "function") {
    const transform = (body as { transformToByteArray: () => Promise<Uint8Array> }).transformToByteArray;
    return Readable.from(Buffer.from(await transform.call(body)));
  }
  throw new Error("S3 object body is not readable");
}

export class FileStorageService {
  constructor(private readonly createS3Client: (region: string) => S3Client = (region) => new S3Client(getAwsClientConfig(region))) {}
  get driver(): StorageDriver {
    return getStorageDriver();
  }

  isS3Enabled(): boolean {
    return this.driver === "s3";
  }

  private async saveUploadedFile(input: {
    fileName: string;
    buffer: Buffer;
    mimeType: string;
    folder: "mediator-service-approvals" | "case-documents" | "court-form-templates" | "complaint-attachments" | "profile-images" | "private-case-notes" | "whatsapp-outbound";
    localDir: string;
    routePrefix: string;
  }): Promise<StoredFile> {
    if (this.driver === "s3") {
      const { bucket, region } = getS3Config(input.folder);
      const storageKey = objectKeyForFileName(input.fileName, input.folder);
      const client = this.createS3Client(region);
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: storageKey,
          Body: input.buffer,
          ContentType: input.mimeType,
          ServerSideEncryption: getServerSideEncryption(),
        }),
      );
      return {
        storageKey,
        fileUrl: `${input.routePrefix}/${encodeURIComponent(fileNameFromObjectKey(storageKey))}`,
      };
    }

    await fs.mkdir(input.localDir, { recursive: true });
    const filePath = path.join(input.localDir, input.fileName);
    await fs.writeFile(filePath, input.buffer);
    return {
      storageKey: filePath,
      fileUrl: `${input.routePrefix}/${encodeURIComponent(input.fileName)}`,
    };
  }

  async saveMediatorServiceApprovalFile(input: {
    fileName: string;
    buffer: Buffer;
    mimeType: string;
  }): Promise<StoredFile> {
    return this.saveUploadedFile({
      ...input,
      folder: "mediator-service-approvals",
      localDir: LOCAL_SERVICE_APPROVAL_DIR,
      routePrefix: SERVICE_APPROVAL_ROUTE_PREFIX,
    });
  }

  async saveProfileImage(input: { fileName: string; buffer: Buffer; mimeType: string }): Promise<StoredFile> {
    return this.saveUploadedFile({
      ...input,
      folder: "profile-images",
      localDir: localProfileImageDir(),
      routePrefix: PROFILE_IMAGE_ROUTE_PREFIX,
    });
  }

  async getProfileImage(fileName: string): Promise<DownloadedFile> {
    if (!/^[0-9a-f-]{36}\.(png|jpg|webp)$/.test(fileName)) throw new Error("Invalid profile image name");
    if (this.driver !== "s3") {
      const filePath = path.join(localProfileImageDir(), fileName);
      const metadata = await fs.stat(filePath);
      return { body: createReadStream(filePath), contentLength: metadata.size };
    }
    const { bucket, region } = getS3Config("profile-images");
    const client = this.createS3Client(region);
    const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: objectKeyForFileName(fileName, "profile-images") }));
    if (!response.Body) throw new Error("Profile image not found");
    return { body: await toReadable(response.Body), contentType: response.ContentType || undefined, contentLength: response.ContentLength };
  }

  async saveCaseDocumentFile(input: {
    fileName: string;
    buffer: Buffer;
    mimeType: string;
  }): Promise<StoredFile> {
    return this.saveUploadedFile({
      ...input,
      folder: "case-documents",
      localDir: LOCAL_CASE_DOCUMENT_DIR,
      routePrefix: CASE_DOCUMENT_ROUTE_PREFIX,
    });
  }

  async deleteCaseDocumentFile(storageKey: string): Promise<void> {
    if (this.driver !== "s3") {
      const root = path.resolve(LOCAL_CASE_DOCUMENT_DIR);
      const resolved = path.resolve(storageKey);
      if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) throw new Error("Invalid case document storage path");
      await fs.unlink(resolved).catch((error: NodeJS.ErrnoException) => { if (error.code !== "ENOENT") throw error; });
      return;
    }
    const { bucket, region, prefix } = getS3Config("case-documents");
    if (storageKey !== prefix && !storageKey.startsWith(`${prefix}/`)) throw new Error("Invalid case document storage key");
    await this.createS3Client(region).send(new DeleteObjectCommand({ Bucket: bucket, Key: storageKey }));
  }

  async saveCourtFormTemplateFile(input: {
    fileName: string;
    buffer: Buffer;
    mimeType: string;
  }): Promise<StoredFile> {
    return this.saveUploadedFile({
      ...input,
      folder: "court-form-templates",
      localDir: LOCAL_COURT_FORM_TEMPLATE_DIR,
      routePrefix: COURT_FORM_TEMPLATE_ROUTE_PREFIX,
    });
  }

  async saveComplaintAttachment(input: { fileName: string; buffer: Buffer; mimeType: string }): Promise<StoredFile> {
    return this.saveUploadedFile({
      ...input,
      folder: "complaint-attachments",
      localDir: LOCAL_COMPLAINT_ATTACHMENT_DIR,
      routePrefix: COMPLAINT_ATTACHMENT_ROUTE_PREFIX,
    });
  }

  async savePrivateCaseNoteAttachment(input: { fileName: string; buffer: Buffer; mimeType: string }): Promise<StoredFile> {
    return this.saveUploadedFile({ ...input, folder: "private-case-notes", localDir: LOCAL_PRIVATE_CASE_NOTE_DIR, routePrefix: "/api/private-case-note-attachments" });
  }

  async saveWhatsappOutboundMedia(input: { fileName: string; buffer: Buffer; mimeType: string }): Promise<StoredFile> {
    return this.saveUploadedFile({ ...input, folder: "whatsapp-outbound", localDir: LOCAL_WHATSAPP_OUTBOUND_DIR, routePrefix: "/api/whatsapp/outbound-media" });
  }

  async openWhatsappOutboundMedia(storageKey: string): Promise<DownloadedFile> {
    if (this.driver !== "s3") {
      const root = path.resolve(LOCAL_WHATSAPP_OUTBOUND_DIR);
      const resolved = path.resolve(storageKey);
      if (!resolved.startsWith(`${root}${path.sep}`)) throw new Error("Invalid WhatsApp media storage path");
      const metadata = await fs.stat(resolved);
      return { body: createReadStream(resolved), contentLength: metadata.size };
    }
    const { bucket, region, prefix } = getS3Config("whatsapp-outbound");
    if (!storageKey.startsWith(`${prefix}/`)) throw new Error("Invalid WhatsApp media storage key");
    const response = await this.createS3Client(region).send(new GetObjectCommand({ Bucket: bucket, Key: storageKey }));
    if (!response.Body) throw new Error("WhatsApp media not found");
    return { body: await toReadable(response.Body), contentType: response.ContentType || undefined, contentLength: response.ContentLength };
  }

  async openPrivateCaseNoteAttachment(storageKey: string): Promise<DownloadedFile> {
    if (this.driver !== "s3") {
      const root = path.resolve(LOCAL_PRIVATE_CASE_NOTE_DIR);
      const resolved = path.resolve(storageKey);
      if (!resolved.startsWith(`${root}${path.sep}`)) throw new Error("Invalid private-note storage path");
      const metadata = await fs.stat(resolved);
      return { body: createReadStream(resolved), contentLength: metadata.size };
    }
    const { bucket, region, prefix } = getS3Config("private-case-notes");
    if (!storageKey.startsWith(`${prefix}/`)) throw new Error("Invalid private-note storage key");
    const response = await this.createS3Client(region).send(new GetObjectCommand({ Bucket: bucket, Key: storageKey }));
    if (!response.Body) throw new Error("Private-note attachment not found");
    return { body: await toReadable(response.Body), contentType: response.ContentType || undefined, contentLength: response.ContentLength };
  }

  async deletePrivateCaseNoteAttachment(storageKey: string): Promise<void> {
    if (this.driver !== "s3") {
      const root = path.resolve(LOCAL_PRIVATE_CASE_NOTE_DIR);
      const resolved = path.resolve(storageKey);
      if (!resolved.startsWith(`${root}${path.sep}`)) throw new Error("Invalid private-note storage path");
      await fs.unlink(resolved).catch((error: NodeJS.ErrnoException) => { if (error.code !== "ENOENT") throw error; });
      return;
    }
    const { bucket, region, prefix } = getS3Config("private-case-notes");
    if (!storageKey.startsWith(`${prefix}/`)) throw new Error("Invalid private-note storage key");
    await this.createS3Client(region).send(new DeleteObjectCommand({ Bucket: bucket, Key: storageKey }));
  }

  async openComplaintAttachment(storageKey: string): Promise<DownloadedFile> {
    if (this.driver !== "s3") {
      const root = path.resolve(LOCAL_COMPLAINT_ATTACHMENT_DIR);
      const resolved = path.resolve(storageKey);
      if (!resolved.startsWith(`${root}${path.sep}`)) throw new Error("Invalid complaint attachment storage path");
      const metadata = await fs.stat(resolved);
      return { body: createReadStream(resolved), contentLength: metadata.size };
    }
    const { bucket, region, prefix } = getS3Config("complaint-attachments");
    if (!storageKey.startsWith(`${prefix}/`)) throw new Error("Invalid complaint attachment storage key");
    const client = new S3Client(getAwsClientConfig(region));
    const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: storageKey }));
    if (!response.Body) throw new Error("S3 object body is empty");
    return { body: await toReadable(response.Body), contentType: response.ContentType || undefined, contentLength: response.ContentLength };
  }

  async deleteComplaintAttachment(storageKey: string): Promise<void> {
    if (this.driver !== "s3") {
      const root = path.resolve(LOCAL_COMPLAINT_ATTACHMENT_DIR);
      const resolved = path.resolve(storageKey);
      if (!resolved.startsWith(`${root}${path.sep}`)) throw new Error("Invalid complaint attachment storage path");
      await fs.unlink(resolved).catch((error: NodeJS.ErrnoException) => { if (error.code !== "ENOENT") throw error; });
      return;
    }
    const { bucket, region, prefix } = getS3Config("complaint-attachments");
    if (!storageKey.startsWith(`${prefix}/`)) throw new Error("Invalid complaint attachment storage key");
    const client = new S3Client(getAwsClientConfig(region));
    await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: storageKey }));
  }

  async getStoredFileBuffer(storageKey: string, folder: "case-documents" | "court-form-templates" = "case-documents"): Promise<Buffer> {
    if (this.driver !== "s3") {
      return fs.readFile(storageKey);
    }
    const { bucket, region } = getS3Config(folder);
    const client = new S3Client(getAwsClientConfig(region));
    const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: storageKey }));
    if (!response.Body) throw new Error("S3 object body is empty");
    const readable = await toReadable(response.Body);
    const chunks: Buffer[] = [];
    for await (const chunk of readable) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }

  async openCaseDocumentByStorageKey(storageKey: string): Promise<DownloadedFile> {
    if (this.driver !== "s3") {
      const root = path.resolve(LOCAL_CASE_DOCUMENT_DIR);
      const resolved = path.resolve(storageKey);
      if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
        throw new Error("Invalid case document storage path");
      }
      const metadata = await fs.stat(resolved);
      return { body: createReadStream(resolved), contentLength: metadata.size };
    }

    const { bucket, region, prefix } = getS3Config("case-documents");
    if (storageKey !== prefix && !storageKey.startsWith(`${prefix}/`)) {
      throw new Error("Invalid case document storage key");
    }
    const client = new S3Client(getAwsClientConfig(region));
    const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: storageKey }));
    if (!response.Body) throw new Error("S3 object body is empty");
    return {
      body: await toReadable(response.Body),
      contentType: response.ContentType || undefined,
      contentLength: response.ContentLength,
    };
  }

  async getMediatorServiceApprovalFile(fileName: string): Promise<DownloadedFile> {
    if (this.driver !== "s3") {
      throw new Error("S3 file proxy is only available when STORAGE_DRIVER=s3");
    }
    const { bucket, region } = getS3Config();
    const client = new S3Client(getAwsClientConfig(region));
    const response = await client.send(
      new GetObjectCommand({
        Bucket: bucket,
        Key: objectKeyForFileName(fileName),
      }),
    );
    if (!response.Body) {
      throw new Error("S3 object body is empty");
    }
    return {
      body: await toReadable(response.Body),
      contentType: response.ContentType || undefined,
      contentLength: response.ContentLength,
    };
  }

  async getCaseDocumentFile(fileName: string): Promise<DownloadedFile> {
    if (this.driver !== "s3") {
      throw new Error("S3 file proxy is only available when STORAGE_DRIVER=s3");
    }
    const { bucket, region } = getS3Config("case-documents");
    const client = new S3Client(getAwsClientConfig(region));
    const response = await client.send(
      new GetObjectCommand({
        Bucket: bucket,
        Key: objectKeyForFileName(fileName, "case-documents"),
      }),
    );
    if (!response.Body) {
      throw new Error("S3 object body is empty");
    }
    return {
      body: await toReadable(response.Body),
      contentType: response.ContentType || undefined,
      contentLength: response.ContentLength,
    };
  }
}

export const fileStorageService = new FileStorageService();
export { LOCAL_UPLOAD_ROOT, SERVICE_APPROVAL_ROUTE_PREFIX, CASE_DOCUMENT_ROUTE_PREFIX, COURT_FORM_TEMPLATE_ROUTE_PREFIX, COMPLAINT_ATTACHMENT_ROUTE_PREFIX };
