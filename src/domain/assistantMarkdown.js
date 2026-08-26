import { marked } from 'marked'

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

export function isSafeMarkdownLink(href) {
  try {
    const url = new URL(String(href || ''))
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

const renderer = new marked.Renderer()

renderer.html = ({ text }) => escapeHtml(text)

renderer.link = function ({ href, title, tokens }) {
  const label = this.parser.parseInline(tokens)
  if (!isSafeMarkdownLink(href)) return label

  const titleAttribute = title ? ` title="${escapeHtml(title)}"` : ''
  return `<a href="${escapeHtml(href)}"${titleAttribute} target="_blank" rel="noopener noreferrer">${label}</a>`
}

renderer.image = ({ text }) =>
  `<span class="assistant-markdown__image-label">图片：${escapeHtml(text || '未命名图片')}</span>`

marked.use({
  renderer,
  gfm: true,
  breaks: true
})

export function renderAssistantMarkdown(content) {
  return marked.parse(String(content || ''), { async: false })
}
