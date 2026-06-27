/**
 * zipUtils.ts — minimal pure-JS ZIP reader for extracting a single file from a
 * base64-encoded ZIP (used for .docx extraction).
 *
 * ZIP format reference: https://pkware.cachefly.net/webdocs/casestudies/APPNOTE.TXT
 * We use the local file headers to find and extract entries without needing a
 * native module.
 */

/** Decode base64 string to Uint8Array */
function b64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function readUint16LE(buf: Uint8Array, offset: number): number {
  return buf[offset] | (buf[offset + 1] << 8);
}

function readUint32LE(buf: Uint8Array, offset: number): number {
  return (buf[offset] | (buf[offset + 1] << 8) | (buf[offset + 2] << 16) | (buf[offset + 3] << 24)) >>> 0;
}

/** Very small inflate implementation for deflate-compressed zip entries */
async function inflate(data: Uint8Array): Promise<Uint8Array> {
  // Use DecompressionStream if available (React Native Hermes supports it via polyfill)
  // Fall back to a no-op for stored (method=0) entries
  if (typeof DecompressionStream !== "undefined") {
    const ds = new DecompressionStream("deflate-raw");
    const writer = ds.writable.getWriter();
    const reader = ds.readable.getReader();
    writer.write(data);
    writer.close();
    const chunks: Uint8Array[] = [];
    let done = false;
    while (!done) {
      const { value, done: d } = await reader.read();
      if (value) chunks.push(value);
      done = d;
    }
    const total = chunks.reduce((n, c) => n + c.length, 0);
    const result = new Uint8Array(total);
    let offset = 0;
    for (const c of chunks) { result.set(c, offset); offset += c.length; }
    return result;
  }
  // If no DecompressionStream — only works for stored (uncompressed) entries
  return data;
}

/** Extract a named file from a base64-encoded ZIP archive. */
export async function unzipBase64(b64: string, targetPath: string): Promise<string> {
  const buf = b64ToBytes(b64);
  const decoder = new TextDecoder("utf-8");
  let offset = 0;

  while (offset < buf.length - 4) {
    const sig = readUint32LE(buf, offset);
    if (sig !== 0x04034b50) break; // Local file header signature

    const compression = readUint16LE(buf, offset + 8);
    const compressedSize = readUint32LE(buf, offset + 18);
    const fileNameLen = readUint16LE(buf, offset + 26);
    const extraLen = readUint16LE(buf, offset + 28);
    const fileNameStart = offset + 30;
    const fileName = decoder.decode(buf.slice(fileNameStart, fileNameStart + fileNameLen));
    const dataStart = fileNameStart + fileNameLen + extraLen;
    const compressedData = buf.slice(dataStart, dataStart + compressedSize);

    if (fileName === targetPath) {
      let rawData: Uint8Array;
      if (compression === 0) {
        rawData = compressedData; // Stored (no compression)
      } else if (compression === 8) {
        rawData = await inflate(compressedData); // Deflate
      } else {
        throw new Error(`Unsupported ZIP compression method: ${compression}`);
      }
      return decoder.decode(rawData);
    }

    offset = dataStart + compressedSize;
  }

  throw new Error(`File "${targetPath}" not found in ZIP archive.`);
}
