export const visibleFolderPaths = ['INBOX', 'Sent', 'Drafts', 'Junk', 'Trash', 'Archive']

export const fallbackFolders = [
  { path: 'INBOX', name: '收件箱' },
  { path: 'Sent', name: '已发送' },
  { path: 'Drafts', name: '草稿箱' },
  { path: 'Junk', name: '垃圾邮件' },
  { path: 'Trash', name: '已删除' },
  { path: 'Archive', name: '归档' },
]

const folderLabelMap = {
  INBOX: '收件箱',
  Sent: '已发送',
  Drafts: '草稿箱',
  Junk: '垃圾邮件',
  Trash: '已删除',
  Archive: '归档',
}

export function folderLabel(folder) {
  return folderLabelMap[folder?.path || folder] || folder?.name || folder?.path || '文件夹'
}

export function visibleFolders(items) {
  const source = items.length ? items : fallbackFolders
  return source
    .filter((f) => visibleFolderPaths.includes(f.path))
    .map((f) => ({ ...f, name: folderLabel(f) }))
}
