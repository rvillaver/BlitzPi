/** Minimal zip reader (central directory + stored/deflate entries) — no dependency, works on Bun and Node. */
import zlib from "node:zlib";

export interface ZipEntry { name: string; size: number; data: () => Buffer }

export function readZip(buf: Buffer): ZipEntry[] {
  // End of central directory: scan back for its signature (comment may follow it).
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error("not a zip file (no end-of-central-directory)");
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const entries: ZipEntry[] = [];
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error("corrupt zip (central directory)");
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20), usize = buf.readUInt32LE(p + 24);
    const nlen = buf.readUInt16LE(p + 28), elen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nlen).toString("utf-8");
    entries.push({
      name, size: usize,
      data: () => {
        if (buf.readUInt32LE(local) !== 0x04034b50) throw new Error(`corrupt zip (local header for ${name})`);
        const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
        const raw = buf.subarray(start, start + csize);
        if (method === 0) return Buffer.from(raw);
        if (method === 8) return zlib.inflateRawSync(raw);
        throw new Error(`unsupported zip compression method ${method} for ${name}`);
      },
    });
    p += 46 + nlen + elen + clen;
  }
  return entries;
}
