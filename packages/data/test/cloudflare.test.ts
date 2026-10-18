import { describe, expect, it } from 'vitest';
import { ensurePagesProject, isAccountId, isProjectName } from '../src/cloudflare.ts';

const ACCOUNT = '0123456789abcdef0123456789abcdef';

/** 按请求返回预先写好的响应，并记下请求 */
function fakeCloudflare(handler: (method: string, url: string) => [number, unknown]) {
  const calls: Array<{ method: string; url: string; body?: string; auth?: string }> = [];
  const impl = (async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    calls.push({
      method,
      url,
      body: init?.body as string | undefined,
      auth: (init?.headers as Record<string, string> | undefined)?.Authorization,
    });
    const [status, body] = handler(method, url);
    return new Response(JSON.stringify(body), { status });
  }) as typeof fetch;
  return { impl, calls };
}

describe('Cloudflare Pages 项目准备', () => {
  it('项目已存在：直接用 API 返回的地址（可能带 Cloudflare 自动加的后缀）', async () => {
    const { impl, calls } = fakeCloudflare(() => [
      200,
      { success: true, result: { subdomain: 'spoiler-free-football-3xk.pages.dev' } },
    ]);
    const r = await ensurePagesProject({
      token: 't0ken',
      accountId: ACCOUNT,
      project: 'spoiler-free-football',
      fetchImpl: impl,
    });
    expect(r).toEqual({
      subdomain: 'spoiler-free-football-3xk.pages.dev',
      url: 'https://spoiler-free-football-3xk.pages.dev/',
      created: false,
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(
      `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/pages/projects/spoiler-free-football`,
    );
    expect(calls[0]!.auth).toBe('Bearer t0ken');
  });

  it('项目不存在：创建（生产分支 main），再用返回的地址', async () => {
    const { impl, calls } = fakeCloudflare((method) =>
      method === 'GET'
        ? [404, { success: false, errors: [{ code: 8000007, message: 'Project not found' }] }]
        : [200, { success: true, result: { subdomain: 'spoiler-free-football.pages.dev' } }],
    );
    const r = await ensurePagesProject({
      token: 't',
      accountId: ACCOUNT,
      project: 'spoiler-free-football',
      fetchImpl: impl,
    });
    expect(r.created).toBe(true);
    expect(r.url).toBe('https://spoiler-free-football.pages.dev/');
    expect(calls[1]!.method).toBe('POST');
    expect(JSON.parse(calls[1]!.body!)).toEqual({
      name: 'spoiler-free-football',
      production_branch: 'main',
    });
  });

  it('Token 无效或权限不够：中文说明要怎么重新创建，不泄露 Token', async () => {
    const { impl } = fakeCloudflare(() => [
      403,
      { success: false, errors: [{ code: 10000, message: 'Authentication error' }] },
    ]);
    const err = await ensurePagesProject({
      token: 'super-secret-token',
      accountId: ACCOUNT,
      project: 'spoiler-free-football',
      fetchImpl: impl,
    }).catch((e: Error) => e);
    expect(String(err)).toMatch(/Cloudflare Pages → Edit/);
    expect(String(err)).toMatch(/CLOUDFLARE_API_TOKEN/);
    expect(String(err)).not.toContain('super-secret-token');
  });

  it('没设置 secrets、Account ID 复制错了：不发请求，直接说明', async () => {
    const { impl, calls } = fakeCloudflare(() => [500, {}]);
    const run = (token?: string, accountId?: string) =>
      ensurePagesProject({
        token,
        accountId,
        project: 'spoiler-free-football',
        fetchImpl: impl,
      }).catch((e: Error) => e.message);
    expect(await run(undefined, ACCOUNT)).toMatch(/没有设置 CLOUDFLARE_API_TOKEN/);
    expect(await run('t', '')).toMatch(/没有设置 CLOUDFLARE_ACCOUNT_ID/);
    expect(await run('t', 'me@example.com')).toMatch(/格式不对/);
    expect(calls).toHaveLength(0);
  });

  it('创建失败时带上 Cloudflare 的原因', async () => {
    const { impl } = fakeCloudflare((method) =>
      method === 'GET'
        ? [404, { success: false, errors: [{ code: 8000007, message: 'Project not found' }] }]
        : [400, { success: false, errors: [{ code: 8000000, message: 'Too many projects' }] }],
    );
    const msg = await ensurePagesProject({
      token: 't',
      accountId: ACCOUNT,
      project: 'spoiler-free-football',
      fetchImpl: impl,
    }).catch((e: Error) => e.message);
    expect(msg).toMatch(/创建 Pages 项目「spoiler-free-football」失败.*Too many projects/);
  });

  it('格式检查', () => {
    expect(isAccountId(ACCOUNT)).toBe(true);
    expect(isAccountId(ACCOUNT.toUpperCase())).toBe(true);
    expect(isAccountId('abc')).toBe(false);
    expect(isProjectName('spoiler-free-football')).toBe(true);
    expect(isProjectName('Spoiler')).toBe(false);
    expect(isProjectName('-x')).toBe(false);
    expect(isProjectName('a'.repeat(59))).toBe(false);
  });
});
