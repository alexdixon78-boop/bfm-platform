import crypto from "crypto";
import { fileStorageService } from "./file-storage.service";

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export function parseProfileImage(dataUrl: string): { buffer: Buffer; mimeType: "image/png" | "image/jpeg" | "image/webp"; extension: string } {
  const match = /^data:(image\/png|image\/jpeg|image\/webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(dataUrl);
  if (!match) throw new Error("Choose a PNG, JPEG or WebP image");
  const buffer = Buffer.from(match[2], "base64");
  if (buffer.length === 0 || buffer.length > MAX_IMAGE_BYTES) throw new Error("Image must be between 1 byte and 5 MB");
  const mimeType = match[1] as "image/png" | "image/jpeg" | "image/webp";
  const signatures: Record<typeof mimeType, boolean> = {
    "image/png": buffer.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex")),
    "image/jpeg": buffer.length > 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff,
    "image/webp": buffer.length > 12 && buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP",
  };
  if (!signatures[mimeType]) throw new Error("Image content does not match its file type");
  return { buffer, mimeType, extension: mimeType === "image/jpeg" ? "jpg" : mimeType.split("/")[1] };
}

export async function saveProfileImage(dataUrl: string) {
  const parsed = parseProfileImage(dataUrl);
  return fileStorageService.saveProfileImage({
    fileName: `${crypto.randomUUID()}.${parsed.extension}`,
    buffer: parsed.buffer,
    mimeType: parsed.mimeType,
  });
}
