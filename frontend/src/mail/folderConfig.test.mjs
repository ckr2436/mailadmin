import test from 'node:test'
import assert from 'node:assert/strict'
import { fallbackFolders, visibleFolderPaths, visibleFolders } from './folderConfig.js'

test('archive is included in fallback and visible paths', () => {
  assert.ok(visibleFolderPaths.includes('Archive'))
  assert.ok(fallbackFolders.some((f) => f.path === 'Archive' && f.name === 'Archive'))
})

test('visibleFolders filters to supported paths including Archive', () => {
  const result = visibleFolders([{ path: 'Archive' }, { path: 'Custom' }])
  assert.deepEqual(result, [{ path: 'Archive' }])
})
