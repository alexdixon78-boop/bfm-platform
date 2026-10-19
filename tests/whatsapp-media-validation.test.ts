import assert from "node:assert/strict";
import { Readable } from "node:stream";
import test from "node:test";
import {
  detectAllowedWhatsappMediaType,
  MAX_WHATSAPP_MEDIA_BYTES,
  readAndValidateWhatsappMedia,
  validateWhatsappMediaBuffer,
  WhatsappMediaValidationError,
} from "../server/services/whatsapp-media-validation";

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function zipWithEntries(entries: Record<string, string>): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let localOffset = 0;
  for (const [name, contents] of Object.entries(entries)) {
    const fileName = Buffer.from(name);
    const data = Buffer.from(contents);
    const checksum = crc32(data);
    const local = Buffer.alloc(30 + fileName.length + data.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(fileName.length, 26);
    fileName.copy(local, 30);
    data.copy(local, 30 + fileName.length);
    localParts.push(local);
    const central = Buffer.alloc(46 + fileName.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(fileName.length, 28);
    central.writeUInt32LE(localOffset, 42);
    fileName.copy(central, 46);
    centralParts.push(central);
    localOffset += local.length;
  }
  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  const entryCount = Object.keys(entries).length;
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entryCount, 8);
  end.writeUInt16LE(entryCount, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(localOffset, 16);
  return Buffer.concat([...localParts, centralDirectory, end]);
}

function docx(contentType = "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"): Buffer {
  return zipWithEntries({
    "[Content_Types].xml": `<Types><Override PartName="/word/document.xml" ContentType="${contentType}"/></Types>`,
    "word/document.xml": '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body/></w:document>',
  });
}

function legacyDoc(streamSize = 4096): Buffer {
  const sectorSize = 512;
  const entriesPerFatSector = sectorSize / 4;
  const entriesPerDifatSector = entriesPerFatSector - 1;
  const streamSectorCount = Math.ceil(streamSize / sectorSize);
  let fatSectorCount = 1;
  let difatSectorCount = 0;
  while (true) {
    difatSectorCount = fatSectorCount > 109 ? Math.ceil((fatSectorCount - 109) / entriesPerDifatSector) : 0;
    const requiredFatSectors = Math.ceil((1 + fatSectorCount + difatSectorCount + streamSectorCount) / entriesPerFatSector);
    if (requiredFatSectors === fatSectorCount) break;
    fatSectorCount = requiredFatSectors;
  }
  const fatSectorIds = Array.from({ length: fatSectorCount }, (_, index) => index + 1);
  const difatSectorIds = Array.from({ length: difatSectorCount }, (_, index) => 1 + fatSectorCount + index);
  const streamStart = 1 + fatSectorCount + difatSectorCount;
  const header = Buffer.alloc(sectorSize, 0);
  Buffer.from("d0cf11e0a1b11ae1", "hex").copy(header);
  header.writeUInt16LE(3, 0x1a);
  header.writeUInt16LE(0xfffe, 0x1c);
  header.writeUInt16LE(9, 0x1e);
  header.writeUInt16LE(6, 0x20);
  header.writeUInt32LE(fatSectorCount, 0x2c);
  header.writeUInt32LE(0, 0x30);
  header.writeUInt32LE(4096, 0x38);
  header.writeUInt32LE(0xfffffffe, 0x3c);
  header.writeUInt32LE(difatSectorIds[0] ?? 0xfffffffe, 0x44);
  header.writeUInt32LE(difatSectorCount, 0x48);
  for (let offset = 0x4c; offset < sectorSize; offset += 4) header.writeUInt32LE(0xffffffff, offset);
  fatSectorIds.slice(0, 109).forEach((id, index) => header.writeUInt32LE(id, 0x4c + index * 4));

  const directory = Buffer.alloc(sectorSize, 0);
  const rootName = Buffer.from("Root Entry\0", "utf16le");
  rootName.copy(directory, 0);
  directory.writeUInt16LE(rootName.length, 64);
  directory.writeUInt8(5, 66);
  directory.writeUInt32LE(0xffffffff, 68);
  directory.writeUInt32LE(0xffffffff, 72);
  directory.writeUInt32LE(1, 76);
  const wordName = Buffer.from("WordDocument\0", "utf16le");
  wordName.copy(directory, 128);
  directory.writeUInt16LE(wordName.length, 128 + 64);
  directory.writeUInt8(2, 128 + 66);
  directory.writeUInt32LE(0xffffffff, 128 + 68);
  directory.writeUInt32LE(0xffffffff, 128 + 72);
  directory.writeUInt32LE(0xffffffff, 128 + 76);
  directory.writeUInt32LE(streamStart, 128 + 116);
  directory.writeBigUInt64LE(BigInt(streamSize), 128 + 120);

  const sectors = Array.from({ length: streamStart + streamSectorCount }, () => Buffer.alloc(sectorSize, 0));
  sectors[0] = directory;
  fatSectorIds.forEach((id) => { sectors[id] = Buffer.alloc(sectorSize, 0xff); });
  const setFat = (sectorId: number, value: number) => {
    const fatIndex = Math.floor(sectorId / entriesPerFatSector);
    sectors[fatSectorIds[fatIndex]].writeUInt32LE(value, (sectorId % entriesPerFatSector) * 4);
  };
  setFat(0, 0xfffffffe);
  fatSectorIds.forEach((id) => setFat(id, 0xfffffffd));
  difatSectorIds.forEach((id, index) => {
    setFat(id, 0xfffffffc);
    const difat = Buffer.alloc(sectorSize, 0xff);
    fatSectorIds.slice(109 + index * entriesPerDifatSector, 109 + (index + 1) * entriesPerDifatSector).forEach((fatId, entryIndex) => difat.writeUInt32LE(fatId, entryIndex * 4));
    difat.writeUInt32LE(difatSectorIds[index + 1] ?? 0xfffffffe, sectorSize - 4);
    sectors[id] = difat;
  });
  for (let index = 0; index < streamSectorCount; index += 1) setFat(streamStart + index, index + 1 < streamSectorCount ? streamStart + index + 1 : 0xfffffffe);
  const stream = Buffer.alloc(streamSize, 0);
  stream.writeUInt16LE(0xa5ec, 0);
  for (let index = 0; index < streamSectorCount; index += 1) stream.subarray(index * sectorSize, (index + 1) * sectorSize).copy(sectors[streamStart + index]);
  return Buffer.concat([header, ...sectors]);
}

test("detects approved image, PDF, Word, and text signatures", () => {
  assert.equal(detectAllowedWhatsappMediaType(Buffer.from([0xff, 0xd8, 0xff, 0x00])), "image/jpeg");
  assert.equal(detectAllowedWhatsappMediaType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), "image/png");
  assert.equal(detectAllowedWhatsappMediaType(Buffer.from("%PDF-1.7")), "application/pdf");
  assert.equal(detectAllowedWhatsappMediaType(docx()), "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
  assert.equal(detectAllowedWhatsappMediaType(legacyDoc()), "application/msword");
  assert.equal(detectAllowedWhatsappMediaType(legacyDoc(7_500_000)), "application/msword");
  assert.equal(detectAllowedWhatsappMediaType(Buffer.from("Private note attachment\n")), "text/plain");
});

test("rejects generic archives and binary control data", () => {
  assert.equal(detectAllowedWhatsappMediaType(Buffer.from("PK\u0003\u0004archive.txt", "latin1")), null);
  assert.equal(detectAllowedWhatsappMediaType(Buffer.from("PK\u0003\u0004[Content_Types].xml word/document.xml", "latin1")), null);
  assert.equal(detectAllowedWhatsappMediaType(docx("application/vnd.ms-word.document.macroEnabled.main+xml")), null);
  assert.equal(detectAllowedWhatsappMediaType(zipWithEntries({ "[Content_Types].xml": "not office xml", "word/document.xml": "not word xml" })), null);
  assert.equal(detectAllowedWhatsappMediaType(Buffer.concat([Buffer.from("d0cf11e0a1b11ae1", "hex"), Buffer.from("WordDocument", "utf16le")])), null);
  assert.equal(detectAllowedWhatsappMediaType(Buffer.from([0x01, 0x02, 0x03, 0x04])), null);
});

test("enforces the 10 MB limit before and during streamed reads", async () => {
  assert.throws(
    () => validateWhatsappMediaBuffer(Buffer.from("small"), MAX_WHATSAPP_MEDIA_BYTES + 1),
    (error) => error instanceof WhatsappMediaValidationError && error.code === "file_too_large",
  );
  await assert.rejects(
    () => readAndValidateWhatsappMedia(Readable.from([Buffer.alloc(MAX_WHATSAPP_MEDIA_BYTES), Buffer.from("x")])),
    (error) => error instanceof WhatsappMediaValidationError && error.code === "file_too_large",
  );
});
