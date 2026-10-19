import path from "path";

const TEN_MB = 10 * 1024 * 1024;
const TWENTY_FIVE_MB = 25 * 1024 * 1024;

type AttachmentInput = { fileName: string; mimeType: string; fileData: string };
export type ValidatedComplaintAttachment = Omit<AttachmentInput, "fileData"> & {
  buffer: Buffer;
  sizeBytes: number;
};

const formats = {
  "application/pdf": { extensions: [".pdf"], signature: [0x25, 0x50, 0x44, 0x46] },
  "image/jpeg": { extensions: [".jpg", ".jpeg"], signature: [0xff, 0xd8, 0xff] },
  "image/png": { extensions: [".png"], signature: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
} as const;

function decodeBase64(value: string): Buffer {
  const normalized = value.replace(/\s+/g, "");
  if (!normalized || normalized.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(normalized)) {
    throw new Error("Attachment data must be valid base64");
  }
  return Buffer.from(normalized, "base64");
}

export function validateComplaintAttachments(inputs: AttachmentInput[]): ValidatedComplaintAttachment[] {
  if (inputs.length > 5) throw new Error("A complaint may contain no more than five attachments");
  let total = 0;
  return inputs.map((input) => {
    if (path.basename(input.fileName) !== input.fileName || input.fileName.includes("\0")) {
      throw new Error("Attachment filename is invalid");
    }
    const format = formats[input.mimeType as keyof typeof formats];
    if (!format) throw new Error("Attachment MIME type is not allowed");
    if (!(format.extensions as readonly string[]).includes(path.extname(input.fileName).toLowerCase())) {
      throw new Error("Attachment extension does not match its MIME type");
    }
    const buffer = decodeBase64(input.fileData);
    if (buffer.length > TEN_MB) throw new Error("Each attachment must be 10 MB or smaller");
    if (!format.signature.every((byte, index) => buffer[index] === byte)) {
      throw new Error("Attachment file signature does not match its MIME type");
    }
    total += buffer.length;
    if (total > TWENTY_FIVE_MB) throw new Error("Attachments must total 25 MB or less");
    return { fileName: input.fileName, mimeType: input.mimeType, buffer, sizeBytes: buffer.length };
  });
}
