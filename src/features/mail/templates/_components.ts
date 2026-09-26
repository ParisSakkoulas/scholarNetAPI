/**
 * _components.ts
 * Reusable HTML snippets for ScholarNet email templates.
 * Import what you need — every template body is composed from these.
 *
 * Colors now come from T (_layout.ts), which holds the same Modern-preset
 * palette. Only the values T doesn't export — the light tint and the
 * warn/danger notice colors — are kept here.
 */

import { T } from './_layout';

/** Colors T doesn't carry (T only has what the shell itself needs). */
const C = {
  primaryTint: '#EAF7FF', // primary.50 — light backgrounds
  warn: '#6B4B00',
  warnBg: '#FFE9A8',
  danger: '#7A1F1F',
  dangerBg: '#FFD2D2',
};

/** Primary CTA button — filled blue, rounded corners, Outlook VML fallback. */
export function ctaButton(label: string, href: string): string {
  return `
    <!--[if mso]>
    <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml"
      href="${href}" style="height:48px; v-text-anchor:middle; width:220px;"
      arcsize="16%" stroke="f" fillcolor="${T.primary}">
      <w:anchorlock/>
      <center style="color:#ffffff; font-family:Arial,sans-serif; font-size:14px; font-weight:600;">
        ${label}
      </center>
    </v:roundrect>
    <![endif]-->
    <!--[if !mso]><!-->
    <a href="${href}"
      style="display:inline-block; padding:14px 36px;
             background-color:${T.primary}; color:#ffffff;
             font-family:${T.sans}; font-size:14px; font-weight:600;
             text-decoration:none; letter-spacing:0.01em;
             border-radius:12px;">
      ${label}
    </a>
    <!--<![endif]-->
  `;
}

/** Mono-styled link fallback line shown below the CTA button. */
export function fallbackLink(href: string): string {
  return `
    <p style="margin:20px 0 0; font-family:${T.mono}; font-size:11px;
               letter-spacing:0.02em; color:${T.ink3}; word-break:break-all;">
      Or copy this link into your browser:<br />
      <a href="${href}" style="color:${T.primary}; text-decoration:none;">${href}</a>
    </p>
  `;
}

/**
 * Blue-tinted notice — use for neutral info / "ignore if not you" messages.
 * @param html Inner HTML (bold tags etc. are fine)
 */
export function infoNotice(html: string): string {
  return `
    <table cellpadding="0" cellspacing="0" width="100%" role="presentation"
      style="margin:24px 0 0; border-left:3px solid ${T.primary};
             background-color:${C.primaryTint}; border-radius:8px;">
      <tr>
        <td style="padding:12px 16px; font-family:${T.sans}; font-size:13px;
                    line-height:1.55; color:${T.ink2};">
          ${html}
        </td>
      </tr>
    </table>
  `;
}

/**
 * Amber-tinted notice — use for security warnings / action-required messages.
 * @param html Inner HTML
 */
export function warningNotice(html: string): string {
  return `
    <table cellpadding="0" cellspacing="0" width="100%" role="presentation"
      style="margin:24px 0 0; border-left:3px solid ${C.warn};
             background-color:${C.warnBg}; border-radius:8px;">
      <tr>
        <td style="padding:12px 16px; font-family:${T.sans}; font-size:13px;
                    line-height:1.55; color:${T.ink2};">
          ${html}
        </td>
      </tr>
    </table>
  `;
}

/**
 * Red-tinted notice — use for account-deletion, breach, or other high-severity alerts.
 * @param html Inner HTML
 */
export function dangerNotice(html: string): string {
  return `
    <table cellpadding="0" cellspacing="0" width="100%" role="presentation"
      style="margin:24px 0 0; border-left:3px solid ${C.danger};
             background-color:${C.dangerBg}; border-radius:8px;">
      <tr>
        <td style="padding:12px 16px; font-family:${T.sans}; font-size:13px;
                    line-height:1.55; color:${T.ink2};">
          ${html}
        </td>
      </tr>
    </table>
  `;
}

/** Standard greeting + body paragraph pair. */
export function bodyParagraph(firstName: string, text: string): string {
  return `
    <p style="margin:0 0 20px; font-family:${T.sans}; font-size:15px;
               line-height:1.55; color:${T.ink2};">
      Hi <strong style="color:${T.ink};">${firstName}</strong>,
    </p>
    <p style="margin:0 0 28px; font-family:${T.sans}; font-size:15px;
               line-height:1.55; color:${T.ink2};">
      ${text}
    </p>
  `;
}

/** Inline mono-styled expiry hint — e.g. "24 hours". */
export function expiryHint(duration: string): string {
  return `<strong style="font-family:${T.mono}; font-size:13px; color:${T.ink};">${duration}</strong>`;
}
