import test from 'node:test'
import assert from 'node:assert/strict'
import { fallbackFolders, visibleFolderPaths, visibleFolders } from './folderConfig.js'

test('archive is included in fallback and visible paths with localized label', () => {
  assert.ok(visibleFolderPaths.includes('Archive'))
  assert.ok(fallbackFolders.some((f) => f.path === 'Archive' && f.name === '归档'))
})

test('visibleFolders filters to supported paths and applies localized labels', () => {
  const result = visibleFolders([{ path: 'Archive' }, { path: 'Custom' }])
  assert.deepEqual(result, [{ path: 'Archive', name: '归档' }])
})
