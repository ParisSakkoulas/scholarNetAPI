import { emailLayout } from './_layout';
import { ctaButton, fallbackLink, infoNotice, bodyParagraph, expiryHint } from './_components';

export const accountLockedTemplate = (
  firstName: string,
  unlockLink: string,
  resetPasswordLink: string,
  maxAttempts: number,
  expiresIn: string,
): string =>
  emailLayout({
    title: 'Your ScholarNet account was locked',
    eyebrow: 'Security Alert',
    heading: 'Your account is locked',
    body: `
      ${bodyParagraph(
        firstName,
        `We locked your ScholarNet account after ${maxAttempts} failed login attempts,
         to keep your research profile safe. If this was you, unlock your account below.`,
      )}
      ${ctaButton('Unlock Account', unlockLink)}
      ${expiryHint(expiresIn)}
      ${fallbackLink(unlockLink)}
      ${infoNotice(
        `Wasn't you? Someone may be trying to access your account.
         Unlock it, then <a href="${resetPasswordLink}">reset your password</a> right away.`,
      )}
    `,
  });
