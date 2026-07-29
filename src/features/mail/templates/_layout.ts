/**
 * _layout.ts
 * ScholarNet design tokens (hex-resolved) + shared email shell.
 */

// ─── Google Fonts ─────────────────────────────────────────────────────────────
const FONT_IMPORT = `
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Source+Serif+4:opsz,wght@8..60,400;8..60,600&family=IBM+Plex+Sans:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet" />
`.trim();

// ─── Logo (Cloudinary — served as PNG for maximum email client compatibility) ─
//
// SVGs from external URLs are blocked by Gmail and Outlook.
// Cloudinary can transcode on the fly: swap /upload/ with /upload/f_png,w_72/
// to get a 72px-wide PNG (2× for retina). No extra config needed.
const LOGO_SRC = 'https://res.cloudinary.com/dbjabrvn8/image/upload/f_png,w_72/v1780222053/scholarNet-mark_vybbnh.svg';

// ─── Token map ────────────────────────────────────────────────────────────────
export const T = {
  paper: '#f4f0e7',
  paper2: '#e9e3d6',
  rule: '#d6cfbf',
  oxford: '#2b3a56',
  oxblood: '#6f2e29',
  ochre: '#c79a49',
  ink: '#21262e',
  ink2: '#3a414b',
  ink3: '#6a717a',
  serif: "'Source Serif 4', Georgia, serif",
  sans: "'IBM Plex Sans', Arial, sans-serif",
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

        <table width="600" cellpadding="0" cellspacing="0" role="presentation"
          style="background-color:#ffffff;
                 border:1px solid ${T.rule};
                 box-shadow:0 30px 70px -40px rgba(20,20,30,0.25),
                             0 4px 12px -6px rgba(20,20,30,0.10);">

          <!-- Header -->
          <tr>
            <td style="background-color:${T.oxford}; padding:24px 40px;">
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
                          <span style="font-family:${T.serif}; font-size:22px;
                                       font-weight:400; color:#ffffff;
                                       letter-spacing:-0.018em;">
                            Scholar<em style="font-style:italic; color:${T.ochre};">Net</em>
                          </span>
                        </td>

                      </tr>
                    </table>
                  </td>

                  <!-- Eyebrow label -->
                  <td align="right" style="vertical-align:middle;">
                    <span style="font-family:${T.mono}; font-size:10px;
                                 letter-spacing:0.14em; text-transform:uppercase;
                                 color:rgba(255,255,255,0.45);">
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
              <h1 style="margin:0; font-family:${T.serif}; font-weight:400;
                          font-size:24px; line-height:1.3;
                          letter-spacing:-0.018em; color:${T.ink};">
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