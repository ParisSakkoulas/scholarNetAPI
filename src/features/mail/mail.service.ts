import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import * as nodemailer from 'nodemailer';
import { Transporter } from 'nodemailer';
import { activationTemplate, resetPasswordTemplate } from './templates';
import { emailChangeTemplate } from './templates/emailChange.template';

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
  private async sendMail(options: { to: string; subject: string; html: string }): Promise<void> {
    try {
      await this.transporter.sendMail({
        from: `"ScholarNet" <${this.fromAddress}>`,
        to: options.to,
        subject: options.subject,
        html: options.html,
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
}
