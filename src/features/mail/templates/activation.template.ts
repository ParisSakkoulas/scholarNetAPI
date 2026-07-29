/**
 * activation.template.ts
 * Sent after registration — prompts the user to verify their email.
 */

import { emailLayout } from './_layout';
import { ctaButton, fallbackLink, infoNotice, bodyParagraph, expiryHint } from './_components';

export const activationTemplate = (firstName: string, link: string): string =>
  emailLayout({
    title: 'Activate your ScholarNet account',
    eyebrow: 'Account Activation',
    heading: 'Activate your account',
    body: `
      ${bodyParagraph(
      firstName,
      `Welcome to ScholarNet. Your account is ready — click below to activate it
         and start managing your research profile.
         This link expires in ${expiryHint('24 hours')}.`,
    )}
      ${ctaButton('Activate Account', link)}
      ${fallbackLink(link)}
      ${infoNotice('If you did not create a ScholarNet account, you can safely ignore this email.')}
    `,
  });