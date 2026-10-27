import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getVideoLinkError, extractUrlAndPlatform } from '../electron/services/videoLink';

test('链接校验区分空白、缺少协议、无效地址和不支持的平台，支持完整分享文案', () => {
  assert.match(getVideoLinkError('   ')!, /内容为空/);
  assert.match(getVideoLinkError('只有文字 douyin.com')!, /未找到有效链接/);
  assert.match(getVideoLinkError('https://')!, /未找到有效链接/);
  assert.match(getVideoLinkError('https://douyin.com.attacker.example/video')!, /仅支持抖音和小红书/);
  for (const value of ['分享 https://v.douyin.com/test/ 复制打开', 'https://xhslink.cn/test', 'https://www.xiaohongshu.com/test']) assert.equal(getVideoLinkError(value), null);
  assert.equal(extractUrlAndPlatform('分享 https://v.douyin.com/test/').platform, 'douyin');
});
