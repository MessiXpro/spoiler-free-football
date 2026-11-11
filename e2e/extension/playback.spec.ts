import { blockExternal, serveSite, sitePage } from '../helpers/flash.ts';
import { expectSwitchesToFullReplay, pinExtensionRules } from '../helpers/playback.ts';
import { test } from './fixtures.ts';

test.describe('浏览器插件：咪咕回放页默认播全场集锦', () => {
  test('等播放器挂载好才切到第一个全场回放，播放器真的在放（只点这一下、不跳转）；之后手动点全场集锦不会被切回去', async ({
    context,
    background,
  }) => {
    await blockExternal(context);
    await serveSite(context, /^https:\/\/www\.miguvideo\.com\//, sitePage('migu-replay.html'));
    await pinExtensionRules(background);
    const page = await context.newPage();
    await expectSwitchesToFullReplay(page);
  });
});
