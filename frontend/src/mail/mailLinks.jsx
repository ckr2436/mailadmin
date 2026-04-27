import React from 'react'
import DOMPurify from 'dompurify'

const MAX_LINK_LENGTH = 8192
const SAFE_HTML_LINK_PROTOCOLS = new Set(['http:', 'https:', 'mailto:', 'tel:'])
const SAFE_TEXT_LINK_PROTOCOLS = new Set(['http:', 'https:'])
const URL_START_PATTERN = /https?:\/\//gi
const HIDDEN_MAIL_CLASS_OR_ID_PATTERN = /(^|[\s_-])(preheader|preview-text|previewtext|visually-hidden|sr-only)([\s_-]|$)/

function normalizeProtocol(href) {
  const match = String(href || '').trim().match(/^([a-z][a-z0-9+.-]*):/i)
  return match ? `${match[1].toLowerCase()}:` : ''
}

function safeMailHref(rawHref, allowedProtocols = SAFE_HTML_LINK_PROTOCOLS) {
  const href = String(rawHref || '').trim()
  if (!href || href.length > MAX_LINK_LENGTH) return ''

  const protocol = normalizeProtocol(href)
  if (!protocol || !allowedProtocols.has(protocol)) return ''

  try {
    const parsed = new URL(href)
    return allowedProtocols.has(parsed.protocol) ? parsed.href : ''
  } catch {
    return ''
  }
}

function styleHidesElement(styleText) {
  const declarations = String(styleText || '')
    .split(';')
    .map((declaration) => declaration.trim())
    .filter(Boolean)
    .reduce((acc, declaration) => {
      const separator = declaration.indexOf(':')
      if (separator <= 0) return acc
      const property = declaration.slice(0, separator).trim().toLowerCase()
      const value = declaration.slice(separator + 1).trim().toLowerCase()
      if (property) acc[property] = value
      return acc
    }, {})

  const isZeroCssValue = (value) => /^(?:[+-]?(?:0+|0*\.0+))(?:[a-z%]+)?$/i.test(String(value || '').trim())

  return (
    declarations.display === 'none'
    || declarations.visibility === 'hidden'
    || isZeroCssValue(declarations.opacity)
    || isZeroCssValue(declarations['max-height'])
    || isZeroCssValue(declarations['max-width'])
    || isZeroCssValue(declarations['font-size'])
    || isZeroCssValue(declarations['line-height'])
    || declarations['mso-hide'] === 'all'
  )
}

function isLikelyHiddenMailElement(element) {
  if (!element) return false
  if (element.hasAttribute('hidden')) return true
  if ((element.getAttribute('aria-hidden') || '').toLowerCase() === 'true') return true

  const classAndId = `${element.className || ''} ${element.id || ''}`.toLowerCase()
  if (HIDDEN_MAIL_CLASS_OR_ID_PATTERN.test(classAndId)) return true

  return styleHidesElement(element.getAttribute('style'))
}

export function sanitizeMailHTML(rawHTML, options = {}) {
  const html = String(rawHTML || '').trim()
  if (!html) return ''
  const { keepInlineStyles = false } = options

  const sanitized = DOMPurify.sanitize(html, {
    FORBID_TAGS: ['img', 'script', 'style', 'link', 'iframe', 'object', 'embed', 'form', 'input', 'button'],
    FORBID_ATTR: ['src', 'srcset'],
  })

  const template = document.createElement('template')
  template.innerHTML = sanitized

  template.content.querySelectorAll('*').forEach((element) => {
    if (isLikelyHiddenMailElement(element)) {
      element.remove()
    }
  })

  template.content.querySelectorAll('a[href]').forEach((anchor) => {
    const href = safeMailHref(anchor.getAttribute('href') || '')
    if (!href) {
      anchor.removeAttribute('href')
      anchor.removeAttribute('target')
      anchor.removeAttribute('rel')
      return
    }
    anchor.setAttribute('href', href)
    anchor.setAttribute('target', '_blank')
    anchor.setAttribute('rel', 'noopener noreferrer nofollow')
  })

  if (!keepInlineStyles) {
    template.content.querySelectorAll('[style]').forEach((element) => {
      element.removeAttribute('style')
    })
  }

  return template.innerHTML.trim()
}

export function hasVisibleMailHTML(sanitizedHTML) {
  const html = String(sanitizedHTML || '').trim()
  if (!html) return false

  const template = document.createElement('template')
  template.innerHTML = html

  template.content.querySelectorAll('script, style, noscript, template').forEach((node) => node.remove())

  const textWalker = document.createTreeWalker(template.content, NodeFilter.SHOW_TEXT)
  let textNode = textWalker.nextNode()

  while (textNode) {
    let hidden = false
    let parent = textNode.parentElement

    while (parent) {
      if (isLikelyHiddenMailElement(parent)) {
        hidden = true
        break
      }
      parent = parent.parentElement
    }

    if (!hidden) {
      const visibleText = String(textNode.textContent || '')
        .replace(/\u00a0/g, ' ')
        .replace(/[\u200B-\u200D\uFEFF]/g, '')
        .trim()
      if (visibleText.length > 0) return true
    }

    textNode = textWalker.nextNode()
  }

  return false
}

function cleanPlainTextURL(value) {
  return String(value || '')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/^<+|>+$/g, '')
    .trim()
}

function stripTrailingURLPunctuation(value) {
  let href = value
  let suffix = ''
  while (/[.,;:!?，。；：！？]$/.test(href)) {
    suffix = href[href.length - 1] + suffix
    href = href.slice(0, -1)
  }
  return { href, suffix }
}

function linkFallbackLabel(href) {
  try {
    const parsed = new URL(href)
    return parsed.hostname ? `打开 ${parsed.hostname}` : '打开链接'
  } catch {
    return '打开链接'
  }
}

function isReadableLinkLabel(value) {
  const label = String(value || '').trim()
  if (label.length < 2 || label.length > 120) return false
  if (/https?:\/\//i.test(label)) return false
  if (/^[\s:：>\-–—|/\\()[\]{}.,;!?，。；！？]+$/.test(label)) return false
  return /[\p{L}\p{N}\u4e00-\u9fff]/u.test(label)
}

function normalizeLinkLabel(value, href) {
  const label = String(value || '')
    .replace(/[\t ]+/g, ' ')
    .replace(/[：:：\-–—|>\s]+$/g, '')
    .trim()
  return isReadableLinkLabel(label) ? label : linkFallbackLabel(href)
}

function createMailLink(href, label, key) {
  return (
    <a
      key={key}
      className="plain-mail-link"
      href={href}
      target="_blank"
      rel="noopener noreferrer nofollow"
      title={href}
    >
      {label}
    </a>
  )
}

function isPlainTextURLTerminator(ch) {
  return /\s/.test(ch) || ch === '<' || ch === '>' || ch === '"' || ch === "'" || ch === '`'
}

function readPlainTextURLAt(text, start) {
  if (!/^https?:\/\//i.test(text.slice(start))) return null

  let index = start
  let parenDepth = 0

  while (index < text.length) {
    const ch = text[index]
    if (isPlainTextURLTerminator(ch)) break

    if (ch === '(') {
      parenDepth += 1
      index += 1
      continue
    }

    if (ch === ')') {
      if (parenDepth > 0) {
        parenDepth -= 1
        index += 1
        continue
      }
      break
    }

    index += 1
  }

  const rawCandidate = text.slice(start, index)
  const { href: strippedCandidate, suffix } = stripTrailingURLPunctuation(rawCandidate)
  const href = safeMailHref(cleanPlainTextURL(strippedCandidate), SAFE_TEXT_LINK_PROTOCOLS)
  if (!href) return null

  return {
    href,
    suffix,
    end: index,
  }
}

function extractParenthesizedURLAt(text, openIndex) {
  if (text[openIndex] !== '(') return null

  let urlStart = openIndex + 1
  while (urlStart < text.length && /\s/.test(text[urlStart])) {
    urlStart += 1
  }

  const parsed = readPlainTextURLAt(text, urlStart)
  if (!parsed) return null

  let closeIndex = parsed.end
  while (closeIndex < text.length && /\s/.test(text[closeIndex])) {
    closeIndex += 1
  }

  if (text[closeIndex] !== ')') return null

  return {
    href: parsed.href,
    suffix: parsed.suffix,
    start: openIndex,
    end: closeIndex + 1,
  }
}

function appendTextWithBareLinks(nodes, text, keyRef) {
  if (!text) return

  const matcher = new RegExp(URL_START_PATTERN)
  let cursor = 0
  let match

  while ((match = matcher.exec(text)) !== null) {
    const start = match.index
    const parsed = readPlainTextURLAt(text, start)

    if (!parsed) {
      matcher.lastIndex = start + match[0].length
      continue
    }

    if (start > cursor) {
      nodes.push(text.slice(cursor, start))
    }
    nodes.push(createMailLink(parsed.href, linkFallbackLabel(parsed.href), `bare-link-${keyRef.current++}`))
    if (parsed.suffix) nodes.push(parsed.suffix)

    cursor = parsed.end
    matcher.lastIndex = parsed.end
  }

  if (cursor < text.length) {
    nodes.push(text.slice(cursor))
  }
}

function splitParenthesizedURLLabel(prefix) {
  const trailingWhitespace = prefix.match(/\s*$/)?.[0] || ''
  const contentEnd = prefix.length - trailingWhitespace.length
  if (contentEnd <= 0) {
    return { beforeLabel: prefix, labelCandidate: '' }
  }

  const lineBreakIndex = Math.max(prefix.lastIndexOf('\n', contentEnd - 1), prefix.lastIndexOf('\r', contentEnd - 1))
  const lineStart = lineBreakIndex + 1
  const segment = prefix.slice(lineStart, contentEnd)
  let labelStart = lineStart

  const leadingConnector = segment.match(/^(\s*(?:(?:and|or)\b|[,&|,;，；]|以及|和|与|及|或)\s+)(\S[\s\S]*)$/i)
  if (leadingConnector && isReadableLinkLabel(leadingConnector[2])) {
    labelStart = lineStart + leadingConnector[1].length
  } else {
    const boundaryPattern = /[,;，；|]|\s[-–—]\s/g
    let boundary
    let lastBoundaryEnd = -1

    while ((boundary = boundaryPattern.exec(segment)) !== null) {
      lastBoundaryEnd = boundary.index + boundary[0].length
    }

    if (lastBoundaryEnd > -1) {
      const candidate = segment.slice(lastBoundaryEnd)
      if (isReadableLinkLabel(candidate)) {
        labelStart = lineStart + lastBoundaryEnd
      }
    }
  }

  return {
    beforeLabel: prefix.slice(0, labelStart),
    labelCandidate: prefix.slice(labelStart, contentEnd),
  }
}

export function buildPlainMailNodes(rawText) {
  const text = String(rawText || '').replace(/\r\n?/g, '\n')
  if (!text) return null

  const nodes = []
  const keyRef = { current: 0 }
  let cursor = 0
  let searchIndex = 0

  while (searchIndex < text.length) {
    const openIndex = text.indexOf('(', searchIndex)
    if (openIndex < 0) break

    const parenthesizedURL = extractParenthesizedURLAt(text, openIndex)
    if (!parenthesizedURL) {
      searchIndex = openIndex + 1
      continue
    }

    const prefix = text.slice(cursor, openIndex)
    const { beforeLabel, labelCandidate } = splitParenthesizedURLLabel(prefix)

    if (isReadableLinkLabel(labelCandidate)) {
      appendTextWithBareLinks(nodes, beforeLabel, keyRef)
      nodes.push(createMailLink(parenthesizedURL.href, normalizeLinkLabel(labelCandidate, parenthesizedURL.href), `labeled-link-${keyRef.current++}`))
    } else {
      appendTextWithBareLinks(nodes, prefix, keyRef)
      nodes.push(createMailLink(parenthesizedURL.href, linkFallbackLabel(parenthesizedURL.href), `parenthesized-link-${keyRef.current++}`))
    }

    if (parenthesizedURL.suffix) nodes.push(parenthesizedURL.suffix)
    cursor = parenthesizedURL.end
    searchIndex = parenthesizedURL.end
  }

  appendTextWithBareLinks(nodes, text.slice(cursor), keyRef)
  return nodes
}
