import type { MailboxMessageView } from './types'

// A fixed timezone keeps SSR and hydration output identical.
const dateTimeFormatter = new Intl.DateTimeFormat('zh-CN', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'Asia/Shanghai',
})

export function formatRemainingTime(seconds: number): string {
  const safe = Math.max(0, seconds)
  const minutes = Math.floor(safe / 60)
  const remainder = safe % 60
  return `${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`
}

export function formatAbsoluteTime(iso: string): string {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? '' : dateTimeFormatter.format(date)
}

export function formatRelativeTime(iso: string, now = Date.now()): string {
  const timestamp = new Date(iso).getTime()

  if (Number.isNaN(timestamp)) {
    return ''
  }

  const diffSeconds = Math.floor((now - timestamp) / 1_000)

  if (diffSeconds < 60) {
    return '刚刚'
  }

  if (diffSeconds < 60 * 60) {
    return `${Math.floor(diffSeconds / 60)} 分钟前`
  }

  if (diffSeconds < 60 * 60 * 24) {
    return `${Math.floor(diffSeconds / (60 * 60))} 小时前`
  }

  if (diffSeconds < 60 * 60 * 24 * 7) {
    return `${Math.floor(diffSeconds / (60 * 60 * 24))} 天前`
  }

  return formatAbsoluteTime(iso)
}

export function stripHtmlPreview(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim()
}

export function formatSender(from: string | null): string {
  if (!from) {
    return '未知发件人'
  }

  const match = from.match(/^\s*"?([^"<]*?)"?\s*<[^>]+>\s*$/)
  return match?.[1]?.trim() || from
}

export function messagePreview(message: MailboxMessageView): string {
  const source =
    message.textBody?.trim() ||
    (message.htmlBody ? stripHtmlPreview(message.htmlBody) : '')

  if (!source) {
    return '（无正文）'
  }

  return source.length > 140 ? `${source.slice(0, 140)}…` : source
}
