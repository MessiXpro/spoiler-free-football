import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
// @ts-expect-error 纯 JS 构建脚本
import { zipDirectory } from '../zip.mjs';

/** 读回 zip：按中央目录逐个解压，确认内容一致 */
function readZip(buf: Buffer): Record<string, string> {
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out: Record<string, string> = {};
  for (let i = 0; i < count; i++) {
    const nameLen = buf.readUInt16LE(p + 28);
    const local = buf.readUInt32LE(p + 42);
    const size = buf.readUInt32LE(p + 20);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString('utf8');
    const lNameLen = buf.readUInt16LE(local + 26);
    const data = buf.subarray(local + 30 + lNameLen, local + 30 + lNameLen + size);
    out[name] = inflateRawSync(data).toString('utf8');
    p += 46 + nameLen;
  }
  return out;
}

describe('zip 打包', () => {
  it('目录结构和内容可以正确读回', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sff-zip-'));
    mkdirSync(join(dir, 'icons'));
    writeFileSync(join(dir, 'manifest.json'), '{"manifest_version":3}');
    writeFileSync(join(dir, 'icons', 'a.txt'), '中文内容');
    const zip = join(dir, '..', `${Date.now()}.zip`);
    zipDirectory(dir, zip);
    expect(readZip(readFileSync(zip))).toEqual({
      'icons/a.txt': '中文内容',
      'manifest.json': '{"manifest_version":3}',
    });
  });
});
