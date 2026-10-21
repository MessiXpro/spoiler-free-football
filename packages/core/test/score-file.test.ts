import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { scoreFileName, scorePath, sha256Hex } from '../src/index.ts';

describe('比分文件名', () => {
  it('sha256Hex 与 Node 自带的 SHA-256 一致（含多块、中文和边界长度）', () => {
    const inputs = [
      '',
      'abc',
      'epl-2026-27-arsenal-chelsea',
      '中文：曼城 vs 利物浦',
      'a'.repeat(55),
      'a'.repeat(56),
      'a'.repeat(63),
      'a'.repeat(64),
      'a'.repeat(1000),
    ];
    for (const s of inputs) {
      expect(sha256Hex(s)).toBe(createHash('sha256').update(s, 'utf8').digest('hex'));
    }
  });

  it('文件名不含队名和轮次，同一场比赛总是同一个文件名', () => {
    const id = 'ucl-2026-27-final-real-madrid-arsenal';
    const name = scoreFileName(id);
    expect(name).toMatch(/^[0-9a-f]{24}$/);
    expect(scorePath(id)).toBe(`scores/${name}.json`);
    expect(scorePath(id)).not.toMatch(/real|madrid|arsenal|final/);
    expect(scoreFileName(id)).toBe(name);
    expect(scoreFileName('ucl-2026-27-final-arsenal-real-madrid')).not.toBe(name);
  });
});
