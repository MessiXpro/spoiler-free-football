import { sanitizeUserState, type UserState } from '@sff/core';

/**
 * 可选的轻量同步服务器（apps/sync-worker，部署到 Cloudflare Workers + KV）。
 * 默认不用；在设置里填了服务器地址才会生效。key 是随机生成的长字符串，相当于密码。
 */
export function randomSyncKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(18));
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function endpointUrl(endpoint: string, key: string) {
  return `${endpoint.replace(/\/+$/, '')}/v1/state/${encodeURIComponent(key)}`;
}

export async function pushToServer(endpoint: string, key: string, state: UserState): Promise<void> {
  const res = await fetch(endpointUrl(endpoint, key), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(state),
  });
  if (!res.ok) throw new Error(`同步服务器返回 ${res.status}`);
}

export async function pullFromServer(endpoint: string, key: string): Promise<UserState | null> {
  const res = await fetch(endpointUrl(endpoint, key), { cache: 'no-store' });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`同步服务器返回 ${res.status}`);
  return sanitizeUserState(await res.json());
}
