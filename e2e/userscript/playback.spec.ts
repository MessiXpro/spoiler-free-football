import { join } from 'node:path';
import { test } from '@playwright/test';
import { blockExternal, serveSite, sitePage } from '../helpers/flash.ts';
import { expectSwitchesToFullReplay } from '../helpers/playback.ts';

const SCRIPT = join(
  import.meta.dirname,
  '..',
  '..',
  'apps',
  'userscript',
  'dist',
  'spoiler-free-football.user.js',
);

test.describe('用户脚本：咪咕回放页默认播全场集锦', () => {
  test('等播放器挂载好才切到第一个全场回放，播放器真的在放（只点这一下、不跳转）；之后手动点全场集锦不会被切回去', async ({
    context,
  }) => {
    // 用脚本内置的规则：页面里下载远程规则的请求被 blockExternal 拦下（404）
    await blockExternal(context);
    await serveSite(context, /^https:\/\/www\.miguvideo\.com\//, sitePage('migu-replay.html'));
    await context.addInitScript({ path: SCRIPT });
    const page = await context.newPage();
    await expectSwitchesToFullReplay(page);
  });
});
