/**
 * email-changed-notice.template.ts
 * Sent to the previous address after an email change has been confirmed.
 */

import { emailLayout } from './_layout';
import { ctaButton, fallbackLink, warningNotice, bodyParagraph } from './_components';

export const emailChangedNoticeTemplate = (
  firstName: string,
  newEmail: string,
  resetLink: string,
): string =>
  emailLayout({
    title: 'Your email address was changed — ScholarNet',
    eyebrow: 'Security Notice',
    heading: 'Your email address was changed',
    body: `
      ${bodyParagraph(
        firstName,
        `The email address on your ScholarNet account was changed to <strong>${newEmail}</strong>.
         You will need to log in again with the new address.`,
      )}
      ${warningNotice(`
        <strong>Was this not you?</strong> Reset your password immediately to regain control of your account.
      `)}
      ${ctaButton('Reset Password', resetLink)}
      ${fallbackLink(resetLink)}
    `,
  });
