import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Job } from 'bull';
import { Resend } from 'resend';

const EMAIL_FROM = 'Aurora <no-reply@aurora.app>';

@Processor('email')
export class EmailProcessor {
  private readonly logger = new Logger(EmailProcessor.name);
  private readonly resend: Resend | null;

  constructor(private readonly configService: ConfigService) {
    const apiKey = this.configService.get<string>('RESEND_API_KEY');
    this.resend = apiKey ? new Resend(apiKey) : null;
    if (!this.resend) {
      this.logger.warn('RESEND_API_KEY not set — emails will only be logged');
    }
  }

  @Process('send-email')
  async handleSendEmail(job: Job) {
    const { template, to, subject, data } = job.data;

    if (!this.resend) {
      this.logger.log(`[EMAIL SKIPPED] to=${to} subject="${subject}" data=${JSON.stringify(data)}`);
      return { sent: false };
    }

    const html = this.renderTemplate(template, data);

    const { error } = await this.resend.emails.send({
      from: EMAIL_FROM,
      to,
      subject,
      html,
    });

    if (error) {
      this.logger.error(`Failed to send email to ${to}: ${JSON.stringify(error)}`);
      throw new Error(`Resend error: ${error.message}`);
    }

    this.logger.log(`Email sent: template=${template} to=${to}`);
    return { sent: true };
  }

  private renderTemplate(template: string, data: Record<string, string>): string {
    switch (template) {
      case 'email_verification':
        return `
          <h2>Bem-vindo à Aurora, ${data.name}!</h2>
          <p>Clique no link abaixo para ativar sua conta:</p>
          <p><a href="${data.verification_url}" style="background:#6366f1;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;">Ativar conta</a></p>
          <p>O link expira em 24 horas.</p>
          <p>Se você não criou uma conta, ignore este email.</p>
        `;
      case 'existing_account_registration_attempt':
        return `
          <p>Alguém tentou criar uma conta Aurora com o email <strong>${data.email}</strong>, mas ele já está cadastrado.</p>
          <p>Se foi você, acesse sua conta normalmente. Se não foi, ignore este email.</p>
        `;
      default:
        return `<pre>${JSON.stringify(data, null, 2)}</pre>`;
    }
  }
}
