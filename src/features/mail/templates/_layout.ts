/**
 * _layout.ts
 * ScholarNet design tokens (hex-resolved) + shared email shell.
 *
 * Recolored to match the "Modern" PrimeNG preset (primary #30AFFF, soft
 * rounded shapes, Inter/JetBrains Mono) instead of the old oxford/oxblood/
 * ochre newspaper palette. Update _components.ts's `C` object to match
 * these same hex values if it hasn't been already — the two files should
 * share one palette.
 */

// ─── Google Fonts ─────────────────────────────────────────────────────────────
const FONT_IMPORT = `
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet" />
`.trim();

// ─── Logo (Cloudinary — served as PNG for maximum email client compatibility) ─
//
// SVGs from external URLs are blocked by Gmail and Outlook.
// Cloudinary can transcode on the fly: swap /upload/ with /upload/f_png,w_72/
// to get a 72px-wide PNG (2× for retina). No extra config needed.
// NOTE: if the source mark itself is still drawn in the old oxford/ochre
// colors, re-export it in the new primary blue before this goes out —
// this file can't recolor an already-rasterized image.
const LOGO_SRC =
  'https://res.cloudinary.com/dbjabrvn8/image/upload/f_png,w_72/v1780222053/scholarNet-mark_vybbnh.svg';

// ─── Token map (Modern preset — keep in sync with _components.ts's `C`) ───────
export const T = {
  paper: '#F8FBFF', // surface.50 — outer page background
  paper2: '#EAF7FF', // primary.50 — heading band / tinted panels
  rule: '#E2EEF7', // surface.200 — hairlines / borders
  primary: '#30AFFF', // primary.500
  primaryDark: '#0A3B61', // primary.900 — header band background
  primaryLight: '#7DD8FF', // primary.300 — accent text on the dark header
  ink: '#1B2733', // surface.900 — headings, strong text
  ink2: '#445A6B', // surface.700 — body text
  ink3: '#5E7688', // surface.600 — muted text
  sans: "'Inter', Arial, sans-serif",
  mono: "'JetBrains Mono', 'Courier New', monospace",
} as const;

// ─── Layout params ────────────────────────────────────────────────────────────
export interface EmailLayoutParams {
  title: string;
  eyebrow?: string;
  heading: string;
  body: string;
  year?: number;
}

// ─── Shell ────────────────────────────────────────────────────────────────────
export function emailLayout(params: EmailLayoutParams): string {
  const year = params.year ?? new Date().getFullYear();

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${params.title}</title>
  ${FONT_IMPORT}
</head>
<body style="margin:0; padding:0; background-color:${T.paper};">

  <!--[if mso]><table width="100%" cellpadding="0" cellspacing="0"><tr><td><![endif]-->
  <table width="100%" cellpadding="0" cellspacing="0" role="presentation"
    style="background-color:${T.paper}; padding:48px 0;">
    <tr>
      <td align="center">

        <!-- border-radius + overflow:hidden is a progressive enhancement:
             Gmail/Apple Mail/most modern clients round the corners; Outlook
             ignores both and falls back to square corners. -->
        <table width="600" cellpadding="0" cellspacing="0" role="presentation"
          style="background-color:#ffffff; border-collapse:separate;
                 border:1px solid ${T.rule}; border-radius:16px; overflow:hidden;
                 box-shadow:0 30px 70px -40px rgba(10,59,97,0.20),
                             0 4px 12px -6px rgba(10,59,97,0.10);">

          <!-- Header -->
          <tr>
            <td style="background-color:${T.primaryDark}; padding:24px 40px;">
              <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
                <tr>

                  <!-- Mark + Wordmark -->
                  <td style="vertical-align:middle;">
                    <table cellpadding="0" cellspacing="0" role="presentation">
                      <tr>

                        <!-- Logo from Cloudinary (PNG transcoded for email compatibility) -->
                        <td style="vertical-align:middle; padding-right:12px;">
                          <img src="${LOGO_SRC}"
                               width="36" height="36"
                               alt="S"
                               style="display:block; border:0; width:36px; height:36px;" />
                        </td>

                        <!-- Wordmark -->
                        <td style="vertical-align:middle;">
                          <span style="font-family:${T.sans}; font-size:20px;
                                       font-weight:400; color:#ffffff;
                                       letter-spacing:-0.01em;">
                            scholar<b style="font-weight:700; color:${T.primaryLight};">Net</b>
                          </span>
                        </td>

                      </tr>
                    </table>
                  </td>

                  <!-- Eyebrow label -->
                  <td align="right" style="vertical-align:middle;">
                    <span style="font-family:${T.mono}; font-size:10px;
                                 letter-spacing:0.14em; text-transform:uppercase;
                                 color:rgba(255,255,255,0.55);">
                      ${params.eyebrow ?? 'Academic Research Platform'}
                    </span>
                  </td>

                </tr>
              </table>
            </td>
          </tr>

          <!-- Heading band -->
          <tr>
            <td style="background-color:${T.paper2}; padding:32px 40px 28px;
                       border-bottom:1px solid ${T.rule};">
              <h1 style="margin:0; font-family:${T.sans}; font-weight:600;
                          font-size:22px; line-height:1.3;
                          letter-spacing:-0.01em; color:${T.ink};">
                ${params.heading}
              </h1>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:36px 40px 32px; background-color:#ffffff;">
              ${params.body}
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background-color:${T.paper2}; padding:20px 40px;
                       border-top:1px solid ${T.rule};">
              <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
                <tr>
                  <td>
                    <span style="font-family:${T.mono}; font-size:10px;
                                 letter-spacing:0.14em; text-transform:uppercase;
                                 color:${T.ink3};">
                      © ${year} ScholarNet
                    </span>
                  </td>
                  <td align="right">
                    <span style="font-family:${T.mono}; font-size:10px;
                                 letter-spacing:0.14em; text-transform:uppercase;
                                 color:${T.ink3};">
                      Academic Research Platform
                    </span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

        </table>

      </td>
    </tr>
  </table>
  <!--[if mso]></td></tr></table><![endif]-->

</body>
</html>`;
}
