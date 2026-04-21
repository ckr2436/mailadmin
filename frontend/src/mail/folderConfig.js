export const visibleFolderPaths = ['INBOX', 'Sent', 'Drafts', 'Junk', 'Trash', 'Archive']

export const fallbackFolders = [
  { path: 'INBOX', name: 'Inbox' },
  { path: 'Sent', name: 'Sent' },
  { path: 'Drafts', name: 'Drafts' },
  { path: 'Junk', name: 'Junk' },
  { path: 'Trash', name: 'Trash' },
  { path: 'Archive', name: 'Archive' },
]

export function visibleFolders(items) {
  const source = items.length ? items : fallbackFolders
  return source.filter((f) => visibleFolderPaths.includes(f.path))
}
