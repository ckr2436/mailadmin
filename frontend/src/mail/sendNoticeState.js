export const SEND_FAILURE_NOTICE = '邮件发送失败，请稍后重试。'

export function getSendNoticeOnMutate() {
  return ''
}

export function getSendNoticeOnSuccess(res) {
  if (res?.warning) return res.warning
  return ''
}

export function getSendNoticeOnError() {
  return SEND_FAILURE_NOTICE
}
