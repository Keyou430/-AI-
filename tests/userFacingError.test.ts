import test from 'node:test';
import assert from 'node:assert/strict';
import { userFacingError } from '../electron/services/userFacingError';

test('底层英文鉴权、限流、超时与网络错误显示中文原因', () => {
  assert.match(
    userFacingError({ status: 401, message: 'Incorrect API key: private-key' }, '操作失败'),
    /接口密钥无效/
  );
  assert.match(
    userFacingError({ status: 429, message: 'Rate limit exceeded' }, '操作失败'),
    /请求过于频繁/
  );
  assert.match(userFacingError({ name: 'APIConnectionTimeoutError' }, '操作失败'), /请求超时/);
  assert.match(
    userFacingError({ message: 'fetch failed', cause: { code: 'ECONNREFUSED' } }, '操作失败'),
    /无法连接服务/
  );
});

test('已有中文业务错误保留，未知异常使用中文回退', () => {
  assert.equal(
    userFacingError(new Error('保存失败：磁盘空间不足'), '操作失败'),
    '保存失败：磁盘空间不足'
  );
  assert.equal(
    userFacingError(new Error('Unexpected upstream response'), '生成脚本失败'),
    '生成脚本失败'
  );
  assert.equal(userFacingError(null, '操作失败'), '操作失败');
});
