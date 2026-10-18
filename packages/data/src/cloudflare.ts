/**
 * 部署到 Cloudflare Pages 之前的准备：确认 Pages 项目存在（没有就创建），并查到网页地址。
 * wrangler pages deploy 在 GitHub Actions 里遇到不存在的项目会直接报 "Project not found"，
 * 所以先用 Cloudflare API 建好；项目名在 *.pages.dev 上被别人占用时，Cloudflare 会自动加后缀，
 * 网页地址要以 API 返回的 subdomain 为准。
 */
const API = 'https://api.cloudflare.com/client/v4';

export interface PagesProjectOptions {
  token?: string;
  accountId?: string;
  project: string;
  fetchImpl?: typeof fetch;
}

export interface PagesProject {
  /** 例如 spoiler-free-football.pages.dev */
  subdomain: string;
  /** https://<subdomain>/ */
  url: string;
  created: boolean;
}

interface CfResponse<T> {
  success?: boolean;
  errors?: Array<{ code?: number; message?: string }>;
  result?: T;
}

const SECRETS_PAGE = 'GitHub 仓库 Settings → Secrets and variables → Actions';

export class CloudflareSetupError extends Error {}

/** Cloudflare 账户 ID 是 32 位十六进制 */
export function isAccountId(v: string): boolean {
  return /^[0-9a-f]{32}$/i.test(v);
}

/** Pages 项目名：小写字母、数字和连字符，不能以连字符开头或结尾，最长 58 个字符 */
export function isProjectName(v: string): boolean {
  return /^[a-z0-9](?:[a-z0-9-]{0,56}[a-z0-9])?$/.test(v);
}

function describeErrors(body: CfResponse<unknown> | null): string {
  const list = body?.errors ?? [];
  return list.map((e) => `${e.message ?? ''}${e.code ? `（${e.code}）` : ''}`).join('；');
}

async function call<T>(
  fetchImpl: typeof fetch,
  token: string,
  path: string,
  init: RequestInit = {},
): Promise<{ status: number; body: CfResponse<T> | null }> {
  let res: Response;
  try {
    res = await fetchImpl(`${API}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...(init.headers ?? {}),
      },
      signal: AbortSignal.timeout(30_000),
    });
  } catch (err) {
    throw new CloudflareSetupError(`连不上 Cloudflare API：${(err as Error).message}`);
  }
  let body: CfResponse<T> | null = null;
  try {
    body = (await res.json()) as CfResponse<T>;
  } catch {
    body = null;
  }
  return { status: res.status, body };
}

function authProblem(status: number, body: CfResponse<unknown> | null): string | null {
  // 10000：认证失败；9109：Token 无效；10001：未授权
  const codes = new Set((body?.errors ?? []).map((e) => e.code));
  if (status === 401 || status === 403 || codes.has(10000) || codes.has(9109)) {
    return (
      'Cloudflare API Token 无效，或者权限不够。请重新创建一个 Token：' +
      'Cloudflare 右上角头像 → My Profile → API Tokens → Create Token → Create Custom Token，' +
      '权限选 Account → Cloudflare Pages → Edit，然后在 ' +
      `${SECRETS_PAGE} 里更新 CLOUDFLARE_API_TOKEN。` +
      (describeErrors(body) ? `（Cloudflare 返回：${describeErrors(body)}）` : '')
    );
  }
  return null;
}

export async function ensurePagesProject(opts: PagesProjectOptions): Promise<PagesProject> {
  const token = opts.token?.trim();
  const accountId = opts.accountId?.trim();
  const project = opts.project.trim();
  const fetchImpl = opts.fetchImpl ?? fetch;
  if (!token) {
    throw new CloudflareSetupError(
      `没有设置 CLOUDFLARE_API_TOKEN：在 ${SECRETS_PAGE} → Secrets 里添加。`,
    );
  }
  if (!accountId) {
    throw new CloudflareSetupError(
      `没有设置 CLOUDFLARE_ACCOUNT_ID：在 ${SECRETS_PAGE} → Secrets 里添加。`,
    );
  }
  if (!isAccountId(accountId)) {
    throw new CloudflareSetupError(
      'CLOUDFLARE_ACCOUNT_ID 的格式不对：应该是 32 位的字母和数字（可能复制成了邮箱、Zone ID 或 Token）。' +
        '登录 Cloudflare 后，浏览器地址栏 dash.cloudflare.com/ 后面那一串就是 Account ID。',
    );
  }
  if (!isProjectName(project)) {
    throw new CloudflareSetupError(
      `Pages 项目名「${project}」不合法：只能用小写字母、数字和连字符（仓库变量 CLOUDFLARE_PROJECT）。`,
    );
  }

  const path = `/accounts/${accountId}/pages/projects/${project}`;
  const got = await call<{ subdomain?: string }>(fetchImpl, token, path);
  const auth = authProblem(got.status, got.body);
  if (auth) throw new CloudflareSetupError(auth);
  if (got.status === 200 && got.body?.result?.subdomain) {
    return toProject(got.body.result.subdomain, false);
  }
  if (got.status !== 404) {
    throw new CloudflareSetupError(
      `查询 Pages 项目失败（HTTP ${got.status}）：${describeErrors(got.body) || '没有更多信息'}`,
    );
  }

  const made = await call<{ subdomain?: string }>(
    fetchImpl,
    token,
    `/accounts/${accountId}/pages/projects`,
    { method: 'POST', body: JSON.stringify({ name: project, production_branch: 'main' }) },
  );
  const auth2 = authProblem(made.status, made.body);
  if (auth2) throw new CloudflareSetupError(auth2);
  if (made.body?.success && made.body.result?.subdomain) {
    return toProject(made.body.result.subdomain, true);
  }
  throw new CloudflareSetupError(
    `创建 Pages 项目「${project}」失败（HTTP ${made.status}）：${describeErrors(made.body) || '没有更多信息'}`,
  );
}

function toProject(subdomain: string, created: boolean): PagesProject {
  const host = subdomain.replace(/^https?:\/\//, '').replace(/\/+$/, '');
  return { subdomain: host, url: `https://${host}/`, created };
}
