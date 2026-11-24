import type { Language } from '@hse/shared';

export interface EmailContent {
  subject: string;
  heading: string;
  paragraphs: string[];
  action?: { label: string; url: string };
  /** Shown in a highlighted box, e.g. a rejection reason quoted as written. */
  quote?: string;
  footer: string;
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/** Every value inserted into HTML goes through this (PLT-05 security test). */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ESCAPES[char] ?? char);
}

/**
 * One consistent, simple layout for every email: HTML (with `lang` and `dir`, T-12) and a
 * plain-text alternative. Styles are inline because many email clients drop <style>.
 */
export function renderLayout(language: Language, content: EmailContent): RenderedEmail {
  const dir = language === 'ar' ? 'rtl' : 'ltr';
  const align = dir === 'rtl' ? 'right' : 'left';
  const font =
    language === 'ar'
      ? "'IBM Plex Sans Arabic', Tahoma, Arial, sans-serif"
      : "'IBM Plex Sans', Arial, sans-serif";

  const paragraphs = content.paragraphs
    .map((text) => `<p style="margin:0 0 16px;line-height:1.6">${escapeHtml(text)}</p>`)
    .join('');
  const quote = content.quote
    ? `<div dir="auto" style="margin:0 0 16px;padding:12px 16px;background:#fefce8;border-radius:8px;white-space:pre-wrap">${escapeHtml(content.quote)}</div>`
    : '';
  const action = content.action
    ? `<p style="margin:24px 0"><a href="${escapeHtml(content.action.url)}" style="display:inline-block;padding:12px 20px;background:#1d4ed8;color:#ffffff;border-radius:8px;text-decoration:none;font-weight:600">${escapeHtml(content.action.label)}</a></p><p style="margin:0 0 16px;font-size:13px;color:#4b5563;word-break:break-all" dir="ltr">${escapeHtml(content.action.url)}</p>`
    : '';

  const html = `<!doctype html><html lang="${language}" dir="${dir}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(content.subject)}</title></head><body style="margin:0;padding:24px;background:#f3f4f6;font-family:${font};color:#030712;text-align:${align}"><div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;padding:32px"><h1 style="margin:0 0 20px;font-size:20px">${escapeHtml(content.heading)}</h1>${paragraphs}${quote}${action}<p style="margin:24px 0 0;font-size:13px;color:#4b5563">${escapeHtml(content.footer)}</p></div></body></html>`;

  const text = [
    content.heading,
    '',
    ...content.paragraphs.flatMap((paragraph) => [paragraph, '']),
    ...(content.quote ? [content.quote, ''] : []),
    ...(content.action ? [`${content.action.label}: ${content.action.url}`, ''] : []),
    content.footer,
  ].join('\n');

  return { subject: content.subject, html, text };
}
