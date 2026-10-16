import { sanitizeUserState, type UserState } from './state.ts';

/**
 * 同步码：把订阅和已看记录压缩成一段文字，在另一台设备粘贴即可导入。
 * 格式：SFF1.<base64url(deflate-raw(JSON))>；不支持压缩的环境用 SFF0.<base64url(JSON)>。
 */
const PREFIX_COMPRESSED = 'SFF1.';
const PREFIX_PLAIN = 'SFF0.';

function toBase64Url(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text: string): Uint8Array {
  const b64 = text.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream) {
  const res = new Response(new Blob([bytes as BlobPart]).stream().pipeThrough(stream));
  return new Uint8Array(await res.arrayBuffer());
}

const hasCompression = () =>
  typeof CompressionStream !== 'undefined' && typeof DecompressionStream !== 'undefined';

export async function encodeSyncCode(state: UserState): Promise<string> {
  const json = new TextEncoder().encode(JSON.stringify(state));
  if (hasCompression()) {
    return PREFIX_COMPRESSED + toBase64Url(await pipe(json, new CompressionStream('deflate-raw')));
  }
  return PREFIX_PLAIN + toBase64Url(json);
}

export class SyncCodeError extends Error {}

export async function decodeSyncCode(code: string): Promise<UserState> {
  const trimmed = code.trim().replace(/\s+/g, '');
  // 允许直接粘贴整条同步链接
  const fromLink = trimmed.match(/(SFF[01]\.[A-Za-z0-9_-]+)/);
  const raw = fromLink?.[1] ?? trimmed;
  try {
    let json: Uint8Array;
    if (raw.startsWith(PREFIX_COMPRESSED)) {
      if (!hasCompression()) throw new SyncCodeError('当前浏览器不支持解压同步码');
      json = await pipe(
        fromBase64Url(raw.slice(PREFIX_COMPRESSED.length)),
        new DecompressionStream('deflate-raw'),
      );
    } else if (raw.startsWith(PREFIX_PLAIN)) {
      json = fromBase64Url(raw.slice(PREFIX_PLAIN.length));
    } else {
      throw new SyncCodeError('这不是有效的同步码');
    }
    const parsed: unknown = JSON.parse(new TextDecoder().decode(json));
    if (!parsed || typeof parsed !== 'object' || (parsed as { v?: unknown }).v !== 1) {
      throw new SyncCodeError('同步码版本不支持');
    }
    return sanitizeUserState(parsed);
  } catch (err) {
    if (err instanceof SyncCodeError) throw err;
    throw new SyncCodeError('同步码已损坏或不完整');
  }
}

/** 同步链接：打开后自动提示导入 */
export function syncLink(appUrl: string, code: string): string {
  const base = appUrl.split('#')[0];
  return `${base}#/import/${code}`;
}
