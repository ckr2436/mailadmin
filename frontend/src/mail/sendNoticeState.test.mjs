import test from 'node:test'
import assert from 'node:assert/strict'
import {
  getSendNoticeOnError,
  getSendNoticeOnMutate,
  getSendNoticeOnSuccess,
  SEND_FAILURE_NOTICE,
} from './sendNoticeState.js'

test('send notice is replaced by warning and then cleared when warning is empty', () => {
  let notice = ''

  notice = getSendNoticeOnMutate()
  notice = getSendNoticeOnSuccess({ warning: 'Message sent, but failed to save to Sent' })
  assert.equal(notice, 'Message sent, but failed to save to Sent')

  notice = getSendNoticeOnMutate()
  notice = getSendNoticeOnSuccess({})
  assert.equal(notice, '')
})

test('send error notice does not retain previous warning', () => {
  let notice = 'Message sent, but failed to save to Sent'

  notice = getSendNoticeOnMutate()
  assert.equal(notice, '')

  notice = getSendNoticeOnError()
  assert.equal(notice, SEND_FAILURE_NOTICE)
})
