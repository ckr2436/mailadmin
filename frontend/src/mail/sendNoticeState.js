export const SEND_FAILURE_NOTICE = 'Failed to send message. Please try again.'

export function getSendNoticeOnMutate() {
  return ''
}

export function getSendNoticeOnSuccess(res) {
  return res?.warning || ''
}

export function getSendNoticeOnError() {
  return SEND_FAILURE_NOTICE
}
