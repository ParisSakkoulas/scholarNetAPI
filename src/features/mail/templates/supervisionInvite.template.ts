/**
 * supervision-invite.template.ts
 * Sent to a supervisor who is not on ScholarNet yet.
 */

import { emailLayout } from './_layout';
import { ctaButton, fallbackLink, bodyParagraph } from './_components';

const esc = (v: string) =>
  v.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export const supervisionInviteTemplate = (
  rawStudentName: string,
  rawTitle: string,
  registerLink: string,
): string => {
  // both values are typed by users
  const studentName = esc(rawStudentName);
  const title = esc(rawTitle);
  return emailLayout({
    title: 'Supervision invitation — ScholarNet',
    eyebrow: 'Supervision',
    heading: `${studentName} invited you as a supervisor`,
    body: `
      ${bodyParagraph(
        'there',
        `${studentName} would like you to supervise "${title}" and share the plan,
         meetings and next steps in one place. Create a ScholarNet account with this
         email address and the invitation will be waiting for you.`,
      )}
      ${ctaButton('Create account', registerLink)}
      ${fallbackLink(registerLink)}
    `,
  });
};
