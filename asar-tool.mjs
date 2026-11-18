// Minimal ASAR reader: list and extract files from an .asar archive.
// Usage: node asar-tool.mjs list <asar> [filterRegex]
//        node asar-tool.mjs extract <asar> <regex> <outDir>
import fs from 'node:fs';
import path from 'node:path';

const [,, cmd, asarPath, a3, a4] = process.argv;
const fd = fs.openSync(asarPath, 'r');
const sizeBuf = Buffer.alloc(8);
fs.readSync(fd, sizeBuf, 0, 8, 0);
// First 4 bytes: UInt32 LE header pickle size; next 4: header string size.
const headerSize = sizeBuf.readUInt32LE(4);
const headerBuf = Buffer.alloc(headerSize);
fs.readSync(fd, headerBuf, 0, headerSize, 8);
const start = headerBuf.indexOf(0x7b); // first '{'
const header = JSON.parse(headerBuf.subarray(start, start + headerBuf.readUInt32LE(start - 4)).toString('utf8'));

const baseOffset = 8 + headerSize;
const files = [];
function walk(node, prefix) {
  if (!node.files) return;
  for (const [name, child] of Object.entries(node.files)) {
    const p = prefix ? `${prefix}/${name}` : name;
    if (child.files) walk(child, p);
    else files.push({ path: p, ...child });
  }
}
walk(header, '');

if (cmd === 'list') {
  const re = a3 ? new RegExp(a3) : null;
  for (const f of files) if (!re || re.test(f.path)) console.log(f.path);
} else if (cmd === 'extract') {
  const re = new RegExp(a3);
  const outDir = a4;
  fs.mkdirSync(outDir, { recursive: true });
  let n = 0;
  for (const f of files) {
    if (!re.test(f.path) || f.unpacked) continue;
    const buf = Buffer.alloc(f.size);
    fs.readSync(fd, buf, 0, f.size, baseOffset + Number(f.offset));
    const out = path.join(outDir, f.path.replace(/[\\/]/g, '__'));
    fs.writeFileSync(out, buf);
    n++;
  }
  console.log(`extracted ${n} files to ${outDir}`);
} else if (cmd === 'extract-text') {
  // Print concatenated contents of matching files (for grep).
  const re = new RegExp(a3);
  for (const f of files) {
    if (!re.test(f.path) || f.unpacked) continue;
    const buf = Buffer.alloc(f.size);
    fs.readSync(fd, buf, 0, f.size, baseOffset + Number(f.offset));
    console.log(`===== ${f.path} =====`);    console.log(buf.toString('utf8'));
  }
}
