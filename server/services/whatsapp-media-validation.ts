import { Readable } from "node:stream";
import { inflateRawSync } from "node:zlib";

export const MAX_WHATSAPP_MEDIA_BYTES = 10 * 1024 * 1024;

export type WhatsappMediaValidationCode = "empty_file" | "file_too_large" | "unsupported_file_type";

export class WhatsappMediaValidationError extends Error {
  constructor(public readonly code: WhatsappMediaValidationCode, message: string) {
    super(message);
    this.name = "WhatsappMediaValidationError";
  }
}

function isUtf8Text(buffer: Buffer): boolean {
  if (buffer.includes(0)) return false;
  if (buffer.some((byte) => (byte < 0x20 && byte !== 0x09 && byte !== 0x0a && byte !== 0x0d) || byte === 0x7f)) return false;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(buffer);
    return true;
  } catch {
    return false;
  }
}

type ZipEntry = { compression: number; checksum: number; compressedSize: number; size: number; dataOffset: number };

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (let index = 0; index < buffer.length; index += 1) {
    const byte = buffer[index];
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function readZipEntries(buffer: Buffer): Map<string, ZipEntry> | null {
  if (buffer.length < 22) return null;
  const eocdSignature = 0x06054b50;
  const centralSignature = 0x02014b50;
  const localSignature = 0x04034b50;
  const searchStart = Math.max(0, buffer.length - 65_557);
  let eocdOffset = -1;
  for (let offset = buffer.length - 22; offset >= searchStart; offset -= 1) {
    if (buffer.readUInt32LE(offset) === eocdSignature) {
      eocdOffset = offset;
      break;
    }
  }
  if (eocdOffset < 0 || eocdOffset + 22 > buffer.length) return null;

  const entryCount = buffer.readUInt16LE(eocdOffset + 10);
  const centralSize = buffer.readUInt32LE(eocdOffset + 12);
  const centralOffset = buffer.readUInt32LE(eocdOffset + 16);
  const commentLength = buffer.readUInt16LE(eocdOffset + 20);
  if (eocdOffset + 22 + commentLength !== buffer.length || centralOffset + centralSize > eocdOffset) return null;

  const entries = new Map<string, ZipEntry>();
  let offset = centralOffset;
  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > eocdOffset || buffer.readUInt32LE(offset) !== centralSignature) return null;
    const flags = buffer.readUInt16LE(offset + 8);
    const compression = buffer.readUInt16LE(offset + 10);
    const checksum = buffer.readUInt32LE(offset + 16);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const size = buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const entryCommentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const nextOffset = offset + 46 + nameLength + extraLength + entryCommentLength;
    if ((flags & 1) !== 0 || ![0, 8].includes(compression) || compressedSize === 0xffffffff || size === 0xffffffff) return null;
    if (nextOffset > eocdOffset || localOffset + 30 > buffer.length || buffer.readUInt32LE(localOffset) !== localSignature) return null;
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
    if (dataOffset + compressedSize > centralOffset) return null;
    const name = buffer.subarray(offset + 46, offset + 46 + nameLength).toString("utf8");
    if (entries.has(name)) return null;
    entries.set(name, { compression, checksum, compressedSize, size, dataOffset });
    offset = nextOffset;
  }
  if (offset !== centralOffset + centralSize) return null;
  return entries;
}

function extractZipEntry(buffer: Buffer, entry: ZipEntry): Buffer | null {
  try {
    const compressed = buffer.subarray(entry.dataOffset, entry.dataOffset + entry.compressedSize);
    const contents = entry.compression === 0
      ? Buffer.from(compressed)
      : inflateRawSync(compressed, { maxOutputLength: Math.min(MAX_WHATSAPP_MEDIA_BYTES, entry.size + 1) });
    if (contents.length !== entry.size || crc32(contents) !== entry.checksum) return null;
    return contents;
  } catch {
    return null;
  }
}

function isDocx(buffer: Buffer): boolean {
  const entries = readZipEntries(buffer);
  const contentTypesEntry = entries?.get("[Content_Types].xml");
  const documentEntry = entries?.get("word/document.xml");
  if (!contentTypesEntry || !documentEntry) return false;
  const contentTypes = extractZipEntry(buffer, contentTypesEntry)?.toString("utf8");
  const document = extractZipEntry(buffer, documentEntry)?.toString("utf8");
  if (!contentTypes || !document) return false;
  if (!contentTypes.includes("application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml")) return false;
  if (contentTypes.toLowerCase().includes("macroenabled")) return false;
  return /<\w*:document\b/.test(document)
    && document.includes("http://schemas.openxmlformats.org/wordprocessingml/2006/main");
}

function isLegacyWordDocument(buffer: Buffer): boolean {
  const freeSector = 0xffffffff;
  const endOfChain = 0xfffffffe;
  if (buffer.length < 512 || !buffer.subarray(0, 8).equals(Buffer.from("d0cf11e0a1b11ae1", "hex"))) return false;
  if (buffer.readUInt16LE(0x1c) !== 0xfffe) return false;
  const majorVersion = buffer.readUInt16LE(0x1a);
  const sectorShift = buffer.readUInt16LE(0x1e);
  if (!((majorVersion === 3 && sectorShift === 9) || (majorVersion === 4 && sectorShift === 12))) return false;
  if (buffer.readUInt16LE(0x20) !== 6) return false;
  const sectorSize = 2 ** sectorShift;
  const headerSize = sectorSize;
  if (buffer.length < headerSize || (buffer.length - headerSize) % sectorSize !== 0) return false;
  const sectorCount = (buffer.length - headerSize) / sectorSize;
  const numberOfFatSectors = buffer.readUInt32LE(0x2c);
  const numberOfDifatSectors = buffer.readUInt32LE(0x48);
  if (numberOfFatSectors < 1 || numberOfFatSectors > sectorCount || numberOfDifatSectors > sectorCount) return false;

  const sector = (id: number): Buffer | null => {
    if (id < 0 || id >= sectorCount) return null;
    return buffer.subarray(headerSize + id * sectorSize, headerSize + (id + 1) * sectorSize);
  };
  const fatSectorIds: number[] = [];
  for (let index = 0; index < Math.min(numberOfFatSectors, 109); index += 1) {
    const id = buffer.readUInt32LE(0x4c + index * 4);
    if (id === freeSector || id >= sectorCount || fatSectorIds.includes(id)) return false;
    fatSectorIds.push(id);
  }
  let nextDifatSector = buffer.readUInt32LE(0x44);
  const seenDifat = new Set<number>();
  for (let index = 0; index < numberOfDifatSectors; index += 1) {
    if (nextDifatSector === endOfChain || nextDifatSector === freeSector || nextDifatSector >= sectorCount || seenDifat.has(nextDifatSector)) return false;
    seenDifat.add(nextDifatSector);
    const difatSector = sector(nextDifatSector);
    if (!difatSector) return false;
    for (let offset = 0; offset < sectorSize - 4 && fatSectorIds.length < numberOfFatSectors; offset += 4) {
      const id = difatSector.readUInt32LE(offset);
      if (id === freeSector || id >= sectorCount || fatSectorIds.includes(id)) return false;
      fatSectorIds.push(id);
    }
    nextDifatSector = difatSector.readUInt32LE(sectorSize - 4);
  }
  if (fatSectorIds.length !== numberOfFatSectors || nextDifatSector !== endOfChain) return false;

  const fat: number[] = [];
  for (const fatSectorId of fatSectorIds) {
    const fatSector = sector(fatSectorId);
    if (!fatSector) return false;
    for (let offset = 0; offset < fatSector.length; offset += 4) fat.push(fatSector.readUInt32LE(offset));
  }
  const readChain = (firstSector: number, limit = sectorCount): number[] | null => {
    const chain: number[] = [];
    const seen = new Set<number>();
    let current = firstSector;
    while (current !== endOfChain) {
      if (current === freeSector || current >= sectorCount || seen.has(current) || chain.length >= limit) return null;
      seen.add(current);
      chain.push(current);
      current = fat[current] ?? freeSector;
    }
    return chain;
  };
  const directoryChain = readChain(buffer.readUInt32LE(0x30));
  if (!directoryChain?.length) return false;
  const directory = Buffer.concat(directoryChain.map((id) => sector(id)!));
  let rootEntry: { firstSector: number; size: number } | null = null;
  let wordEntry: { firstSector: number; size: number } | null = null;
  for (let offset = 0; offset + 128 <= directory.length; offset += 128) {
    const nameLength = directory.readUInt16LE(offset + 64);
    const objectType = directory.readUInt8(offset + 66);
    if (nameLength < 2 || nameLength > 64 || nameLength % 2 !== 0) continue;
    const name = directory.subarray(offset, offset + nameLength - 2).toString("utf16le");
    const firstSector = directory.readUInt32LE(offset + 116);
    const size64 = directory.readBigUInt64LE(offset + 120);
    if (size64 > BigInt(MAX_WHATSAPP_MEDIA_BYTES)) continue;
    const entry = { firstSector, size: Number(size64) };
    if (objectType === 5 && name === "Root Entry") rootEntry = entry;
    if (objectType === 2 && name === "WordDocument") wordEntry = entry;
  }
  if (!rootEntry || !wordEntry || wordEntry.size < 2) return false;

  const miniCutoff = buffer.readUInt32LE(0x38);
  let wordStart: Buffer | null = null;
  if (wordEntry.size >= miniCutoff) {
    const chain = readChain(wordEntry.firstSector);
    if (!chain?.length || chain.length * sectorSize < wordEntry.size) return false;
    wordStart = sector(chain[0]);
  } else {
    const miniFatChain = readChain(buffer.readUInt32LE(0x3c));
    const rootChain = readChain(rootEntry.firstSector);
    if (!miniFatChain?.length || !rootChain?.length) return false;
    const miniFatBuffer = Buffer.concat(miniFatChain.map((id) => sector(id)!));
    const miniFat: number[] = [];
    for (let offset = 0; offset < miniFatBuffer.length; offset += 4) miniFat.push(miniFatBuffer.readUInt32LE(offset));
    const rootStream = Buffer.concat(rootChain.map((id) => sector(id)!)).subarray(0, rootEntry.size);
    if (wordEntry.firstSector >= miniFat.length || wordEntry.firstSector * 64 + 2 > rootStream.length) return false;
    wordStart = rootStream.subarray(wordEntry.firstSector * 64);
  }
  return Boolean(wordStart && wordStart.readUInt16LE(0) === 0xa5ec);
}

export function detectAllowedWhatsappMediaType(buffer: Buffer): string | null {
  if (buffer.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return "image/jpeg";
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (buffer.subarray(0, 4).toString("ascii") === "%PDF") return "application/pdf";
  if (buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";

  if (buffer.subarray(0, 2).toString("hex") === "504b") {
    if (isDocx(buffer)) {
      return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    }
    return null;
  }

  if (buffer.subarray(0, 8).toString("hex") === "d0cf11e0a1b11ae1") {
    if (isLegacyWordDocument(buffer)) return "application/msword";
    return null;
  }

  if (isUtf8Text(buffer)) return "text/plain";
  return null;
}

export function validateWhatsappMediaBuffer(buffer: Buffer, declaredLength?: number): { buffer: Buffer; mimeType: string } {
  if ((declaredLength || 0) > MAX_WHATSAPP_MEDIA_BYTES || buffer.length > MAX_WHATSAPP_MEDIA_BYTES) {
    throw new WhatsappMediaValidationError("file_too_large", "File exceeds the 10 MB limit");
  }
  if (buffer.length === 0) throw new WhatsappMediaValidationError("empty_file", "Empty files are not supported");
  const mimeType = detectAllowedWhatsappMediaType(buffer);
  if (!mimeType) throw new WhatsappMediaValidationError("unsupported_file_type", "Unsupported attachment type");
  return { buffer, mimeType };
}

export async function readAndValidateWhatsappMedia(stream: Readable, declaredLength?: number): Promise<{ buffer: Buffer; mimeType: string }> {
  if ((declaredLength || 0) > MAX_WHATSAPP_MEDIA_BYTES) {
    throw new WhatsappMediaValidationError("file_too_large", "File exceeds the 10 MB limit");
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of stream) {
    const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += data.length;
    if (size > MAX_WHATSAPP_MEDIA_BYTES) {
      throw new WhatsappMediaValidationError("file_too_large", "File exceeds the 10 MB limit");
    }
    chunks.push(data);
  }
  return validateWhatsappMediaBuffer(Buffer.concat(chunks), declaredLength);
}
