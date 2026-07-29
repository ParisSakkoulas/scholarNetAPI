/**
 * email-change.template.ts
 * Sent to the new address when the user requests an email update.
 */

import { emailLayout } from './_layout';
import { ctaButton, fallbackLink, warningNotice, bodyParagraph, expiryHint } from './_components';

export const emailChangeTemplate = (firstName: string, confirmLink: string): string =>
  emailLayout({
    title: 'Confirm your new email address — ScholarNet',
    eyebrow: 'Email Change',
    heading: 'Confirm your new email address',
    body: `
      ${bodyParagraph(
      firstName,
      `We received a request to update the email address on your ScholarNet account.
         Click below to confirm this change.
         The link expires in ${expiryHint('24 hours')}.`,
    )}
      ${ctaButton('Confirm New Email', confirmLink)}
      ${fallbackLink(confirmLink)}
      ${warningNotice(`
        <strong>Didn't request this?</strong> Your email address has not been changed yet.
        Secure your account immediately by updating your password — do not click the link above.
      `)}
    `,
  });