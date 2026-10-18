/**
 * 逐字符归一化：全角数字/标点转半角、各种破折号统一为 "-"、各种冒号统一为 ":"。
 * 每个字符只映射成一个字符，所以归一化后字符串与原文下标一一对应，
 * 可以直接用匹配到的下标去替换原文。
 */
const DASHES = new Set([
  0x2010, 0x2011, 0x2012, 0x2013, 0x2014, 0x2015, 0x2212, 0xfe58, 0xfe63, 0xff0d, 0x2e3a, 0x2e3b,
  0x30fc /* ー 常被误用作破折号 */,
]);
const COLONS = new Set([0xff1a, 0xfe55, 0x2236, 0xfe13, 0xa789]);
const SPACES = new Set([0x3000, 0x00a0, 0x2002, 0x2003, 0x2009, 0x200a, 0x202f, 0x205f]);
const APOSTROPHES = new Set([0x2019, 0x2032, 0xff07, 0x02bc]);

export function normalizeChar(code: number): number {
  if (DASHES.has(code)) return 0x2d;
  if (COLONS.has(code)) return 0x3a;
  if (SPACES.has(code)) return 0x20;
  if (APOSTROPHES.has(code)) return 0x27;
  // 全角 ASCII（！到～）
  if (code >= 0xff01 && code <= 0xff5e) return code - 0xfee0;
  // 中文括号
  if (code === 0x3014 || code === 0x3010) return 0x28; // 〔【 → (
  if (code === 0x3015 || code === 0x3011) return 0x29; // 〕】 → )
  return code;
}

export function normalizeText(text: string): string {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    const n = normalizeChar(code);
    out += n === code ? text[i] : String.fromCharCode(n);
  }
  return out;
}
