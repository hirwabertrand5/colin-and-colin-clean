// Fetch only mongod.exe from MongoDB's official ZIP (the full ZIP contains
// hundreds of MB of debug symbols which the disposable test server never uses).
const fs = require('node:fs/promises');
const path = require('node:path');
const zlib = require('node:zlib');
const { promisify } = require('node:util');
const url = 'https://fastdl.mongodb.org/windows/mongodb-windows-x86_64-7.0.14.zip';
async function range(start, end) {
  const response = await fetch(url, { headers: { Range: `bytes=${start}-${end}` }, signal: AbortSignal.timeout(120000) });
  if (response.status !== 206) throw new Error(`Expected a range response; received ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}
async function main() {
  const head = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(30000) });
  if (!head.ok) throw new Error(`MongoDB download failed: ${head.status}`);
  const size = Number(head.headers.get('content-length'));
  const tail = await range(Math.max(0, size - 65557), size - 1);
  const end = tail.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (end < 0) throw new Error('ZIP directory not found');
  const directorySize = tail.readUInt32LE(end + 12);
  const directoryOffset = tail.readUInt32LE(end + 16);
  const directory = await range(directoryOffset, directoryOffset + directorySize - 1);
  for (let offset = 0; offset < directory.length;) {
    if (directory.readUInt32LE(offset) !== 0x02014b50) throw new Error('Invalid ZIP directory');
    const nameSize = directory.readUInt16LE(offset + 28);
    const name = directory.toString('utf8', offset + 46, offset + 46 + nameSize);
    if (name.endsWith('/bin/mongod.exe')) {
      const method = directory.readUInt16LE(offset + 10);
      const crc = directory.readUInt32LE(offset + 16);
      const compressedSize = directory.readUInt32LE(offset + 20);
      const uncompressedSize = directory.readUInt32LE(offset + 24);
      const fileOffset = directory.readUInt32LE(offset + 42);
      const header = await range(fileOffset, fileOffset + 29);
      if (header.readUInt32LE(0) !== 0x04034b50) throw new Error('Invalid ZIP entry');
      const start = fileOffset + 30 + header.readUInt16LE(26) + header.readUInt16LE(28);
      console.log(`Downloading mongod.exe only (${Math.round(compressedSize / 1048576)} MB instead of ${Math.round(size / 1048576)} MB).`);
      // Small independent ranges avoid a stalled long-running transfer.
      const chunkSize = 2 * 1024 * 1024;
      const chunks = new Array(Math.ceil(compressedSize / chunkSize));
      let next = 0;
      await Promise.all(Array.from({ length: 4 }, async () => {
        while (next < chunks.length) {
          const index = next++;
          const from = start + index * chunkSize;
          chunks[index] = await range(from, Math.min(start + compressedSize - 1, from + chunkSize - 1));
        }
      }));
      const compressed = Buffer.concat(chunks);
      const binary = method === 8 ? await promisify(zlib.inflateRaw)(compressed) : method === 0 ? compressed : null;
      if (!binary || binary.length !== uncompressedSize || zlib.crc32(binary) !== crc) throw new Error('MongoDB executable failed ZIP integrity verification');
      const target = path.resolve(__dirname, '../node_modules/.cache/mongodb-memory-server/test-mongod.exe');
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, binary);
      console.log(`Verified official MongoDB executable: ${target}`);
      return;
    }
    offset += 46 + nameSize + directory.readUInt16LE(offset + 30) + directory.readUInt16LE(offset + 32);
  }
  throw new Error('mongod.exe not found in the official MongoDB ZIP');
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
