export function getCookieValue(name) {
  if (!name) return ''
  const pair = document.cookie
    .split('; ')
    .find((value) => value.startsWith(`${name}=`))
  return pair ? decodeURIComponent(pair.split('=').slice(1).join('=')) : ''
}
