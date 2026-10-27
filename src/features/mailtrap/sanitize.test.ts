import { describe, expect, test } from 'bun:test'

import { sanitizeEmailHtml } from './sanitize'

describe('sanitizeEmailHtml', () => {
  test('removes scripts, event handlers, and dangerous URLs', () => {
    const output = sanitizeEmailHtml(
      '<p onclick="alert(1)">Hello<script>alert(1)</script>' +
        '<a href="javascript:alert(1)">bad</a>' +
        '<a href="https://example.com">good</a></p>',
    )

    expect(output).not.toContain('<script')
    expect(output).not.toContain('onclick')
    expect(output).not.toContain('javascript:')
    expect(output).toContain('Hello')
    expect(output).toContain('href="https://example.com"')
    expect(output).toContain('rel="nofollow noopener noreferrer"')
  })

  test('removes images, iframes, forms, and inline styles', () => {
    const output = sanitizeEmailHtml(
      '<div style="background:url(https://tracker.test/pixel)">' +
        '<img src="https://tracker.test/pixel.png">' +
        '<iframe src="https://evil.test"></iframe>' +
        '<form action="/steal"><input name="secret"></form>' +
        '<p style="color:red">Body</p></div>',
    )

    expect(output).not.toContain('<img')
    expect(output).not.toContain('<iframe')
    expect(output).not.toContain('<form')
    expect(output).not.toContain('<input')
    expect(output).not.toContain('style=')
    expect(output).toContain('<p>Body</p>')
  })

  test('keeps safe formatting, lists, and tables', () => {
    const output = sanitizeEmailHtml(
      '<h1>Title</h1><ul><li><strong>One</strong></li></ul>' +
        '<table><tr><td colspan="2">Cell</td></tr></table>',
    )

    expect(output).toContain('<h1>Title</h1>')
    expect(output).toContain('<strong>One</strong>')
    expect(output).toContain('<td colspan="2">Cell</td>')
  })

  test('removes protocol-relative and data URLs', () => {
    const output = sanitizeEmailHtml(
      '<a href="//evil.test">a</a><a href="data:text/html,hi">b</a>',
    )

    expect(output).not.toContain('//evil.test')
    expect(output).not.toContain('data:')
  })
})
