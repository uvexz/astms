import type { ReactNode } from 'react'

const URL_PATTERN = /((?:https?:\/\/|mailto:)[^\s<>"']+)/gi
const TRAILING_PUNCTUATION = /[.,;:!?，。；：！？、]+$/

function isSafeUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return ['http:', 'https:', 'mailto:'].includes(url.protocol)
  } catch {
    return false
  }
}

export function LinkifiedText({ text }: { text: string }) {
  const nodes: Array<ReactNode> = []
  let lastIndex = 0

  for (const match of text.matchAll(URL_PATTERN)) {
    const raw = match[0]
    const index = match.index
    const trailing = raw.match(TRAILING_PUNCTUATION)?.[0] ?? ''
    const url = trailing ? raw.slice(0, -trailing.length) : raw

    if (index > lastIndex) {
      nodes.push(text.slice(lastIndex, index))
    }

    if (isSafeUrl(url)) {
      nodes.push(
        <a
          key={`${index}-${url}`}
          href={url}
          target="_blank"
          rel="noopener noreferrer nofollow"
          className="text-kumo-link underline decoration-kumo-link/40 underline-offset-2 hover:decoration-kumo-link"
        >
          {url}
        </a>,
      )
    } else {
      nodes.push(url)
    }

    if (trailing) {
      nodes.push(trailing)
    }

    lastIndex = index + raw.length
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex))
  }

  return (
    <div className="text-base leading-6 break-words whitespace-pre-wrap text-kumo-default">
      {nodes.length > 0 ? nodes : text}
    </div>
  )
}

const FRAME_STYLES = `
  body {
    margin: 0;
    padding: 0;
    color: #18181b;
    font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
    font-size: 14px;
    line-height: 1.65;
    overflow-wrap: anywhere;
  }
  a { color: #1d4ed8; }
  table { max-width: 100%; border-collapse: collapse; }
  pre { white-space: pre-wrap; }
`

export function HtmlMessageFrame({ html }: { html: string }) {
  const document = `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:;" />
    <style>${FRAME_STYLES}</style>
  </head>
  <body>${html}</body>
</html>`

  return (
    <iframe
      title="邮件 HTML 正文"
      sandbox=""
      referrerPolicy="no-referrer"
      srcDoc={document}
      className="h-96 w-full rounded-md bg-white"
    />
  )
}
