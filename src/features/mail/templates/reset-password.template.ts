/**
 * reset-password.template.ts
 * Sent when the user triggers a password reset.
 */

import { emailLayout } from './_layout';
import { ctaButton, fallbackLink, infoNotice, bodyParagraph, expiryHint } from './_components';

export const resetPasswordTemplate = (firstName: string, link: string): string =>
  emailLayout({
    title: 'Reset your ScholarNet password',
    eyebrow: 'Password Reset',
    heading: 'Password reset request',
    body: `
      ${bodyParagraph(
      firstName,
      `We received a request to reset the password for your ScholarNet account.
         Click below to choose a new password.
         This link expires in ${expiryHint('1 hour')}.`,
    )}
      ${ctaButton('Reset Password', link)}
      ${fallbackLink(link)}
      ${infoNotice('If you did not request a password reset, your password remains unchanged — you can safely ignore this email.')}
    `,
  });