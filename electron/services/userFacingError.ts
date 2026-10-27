/** 将底层英文异常转换为可操作的中文提示，原始异常由调用方写入日志。 */
export function userFacingError(error: unknown, fallback: string): string {
  const details = error && typeof error === 'object' ? (error as Record<string, unknown>) : {};
  const message = typeof details.message === 'string' ? details.message : '';
  // 业务校验错误已提供中文说明，保持具体原因。
  if (/[\u4e00-\u9fff]/u.test(message)) return message;
  const status = Number(details.status);
  if (status === 401) return '接口密钥无效或已过期，请在系统设置中更新。';
  if (status === 403) return '接口访问被拒绝，请检查账户权限和余额。';
  if (status === 402 || status === 429) return '接口额度不足或请求过于频繁，请稍后重试或检查额度。';
  const cause =
    details.cause && typeof details.cause === 'object'
      ? (details.cause as Record<string, unknown>)
      : {};
  const reason = [details.name, details.code, cause.code, message]
    .filter((value) => typeof value === 'string')
    .join(' ');
  if (/timeout|timed?\s*out|ETIMEDOUT/i.test(reason)) return '请求超时，请检查网络后重试。';
  if (/connection|fetch failed|ENOTFOUND|ECONN|EAI_AGAIN|network/i.test(reason))
    return '无法连接服务，请检查网络和接口地址。';
  return fallback;
}
