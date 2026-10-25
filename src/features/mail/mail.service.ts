import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import * as nodemailer from 'nodemailer';
import { Transporter } from 'nodemailer';
import { activationTemplate, resetPasswordTemplate } from './templates';
import { emailChangeTemplate } from './templates/emailChange.template';
import { emailChangedNoticeTemplate } from './templates/emailChangedNotice.template';
import { supervisionInviteTemplate } from './templates/supervisionInvite.template';
import { accountLockedTemplate } from './templates/accountLocked.template';
import { MAX_LOGIN_ATTEMPTS, UNLOCK_TOKEN_TTL_HOURS } from '../auth/constants/auth.constants';

@Injectable()
export class MailService {
  private readonly transporter: Transporter;
  private readonly fromAddress: string;

  constructor(private readonly config: ConfigService) {
    this.fromAddress = this.config.get<string>('mail.from')!;

    this.transporter = nodemailer.createTransport({
      host: this.config.get<string>('mail.host') ?? '',
      port: this.config.get<number>('mail.port') ?? 465,
      secure: true,
      auth: {
        user: this.config.get<string>('mail.user') ?? '',
        pass: this.config.get<string>('mail.password') ?? '',
      },
    });
  }

  //   Simple generic method to send an email. In a real app, you'd likely have more specific methods like sendVerificationEmail, sendPasswordResetEmail, etc.
  private async sendMail(options: {
    to: string;
    subject: string;
    html: string;
    text?: string;
  }): Promise<void> {
    try {
      await this.transporter.sendMail({
        from: `"ScholarNet" <${this.fromAddress}>`,
        to: options.to,
        subject: options.subject,
        html: options.html,
        text: options.text,
      });
    } catch (error) {
      console.error('Failed to send email:', error);
      // We don't throw here — email failure should not crash the request.
      // The user can request a resend.
    }
  }

  async sendActivationEmail(to: string, firstName: string, token: string): Promise<void> {
    const clientUrl = this.config.get<string>('app.clientUrl');
    const activationLink = `${clientUrl}/auth/verify-email/${token}`;

    await this.sendMail({
      to,
      subject: 'Activate your ScholarNet account',
      html: activationTemplate(firstName, activationLink),
    });
  }

  async sendResetPasswordEmail(to: string, firstName: string, token: string): Promise<void> {
    const clientUrl = this.config.get<string>('app.clientUrl');
    const resetLink = `${clientUrl}/auth/reset-password?token=${token}`;

    await this.sendMail({
      to,
      subject: 'Reset your ScholarNet password',
      html: resetPasswordTemplate(firstName, resetLink),
    });
  }

  async sendEmailChangeConfirmation(to: string, firstName: string, token: string): Promise<void> {
    const clientUrl = this.config.get<string>('app.clientUrl');
    const confirmLink = `${clientUrl}/auth/confirm-email?token=${token}`;

    await this.sendMail({
      to,
      subject: 'Confirm your new ScholarNet email address',
      html: emailChangeTemplate(firstName, confirmLink),
    });
  }

  /** Sent to the OLD address after the change, so the real owner can react if it was not them. */
  async sendEmailChangedNotice(to: string, firstName: string, newEmail: string): Promise<void> {
    const clientUrl = this.config.get<string>('app.clientUrl');
    const resetLink = `${clientUrl}/auth/forgot-password`;

    await this.sendMail({
      to,
      subject: 'Your ScholarNet email address was changed',
      html: emailChangedNoticeTemplate(firstName, newEmail, resetLink),
    });
  }

  async sendAccountLockedEmail(
    user: { email: string; firstName: string },
    token: string,
  ): Promise<void> {
    const clientUrl = this.config.get<string>('app.clientUrl');
    const unlockLink = `${clientUrl}/auth/unlock?token=${token}`;
    const resetLink = `${clientUrl}/auth/forgot-password`;

    await this.sendMail({
      to: user.email,
      subject: 'Your ScholarNet account was locked',
      html: accountLockedTemplate(
        user.firstName,
        unlockLink,
        resetLink,
        MAX_LOGIN_ATTEMPTS,
        `${UNLOCK_TOKEN_TTL_HOURS} hour`,
      ),
      text: `Your ScholarNet account was locked after ${MAX_LOGIN_ATTEMPTS} failed login attempts. Unlock it here: ${unlockLink}`,
    });
  }

  /** Invites someone who has no account yet; the invite is claimed when they sign up with this address. */
  async sendSupervisionInviteEmail(to: string, studentName: string, title: string): Promise<void> {
    const clientUrl = this.config.get<string>('app.clientUrl');
    const registerLink = `${clientUrl}/auth/register`;

    await this.sendMail({
      to,
      subject: `${studentName} invited you to supervise their thesis on ScholarNet`,
      html: supervisionInviteTemplate(studentName, title, registerLink),
      text: `${studentName} invited you to supervise "${title}" on ScholarNet. Create an account with this email address to answer: ${registerLink}`,
    });
  }
}
