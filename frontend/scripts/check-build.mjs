import { access } from 'node:fs/promises'

const required = ['dist/index.html', 'dist/mail/index.html', 'dist/admin/index.html']

for (const file of required) {
  try {
    await access(file)
  } catch {
    console.error(`Missing build artifact: ${file}`)
    process.exit(1)
  }
}

console.log('Build artifact check passed.')
