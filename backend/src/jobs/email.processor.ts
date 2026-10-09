import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';

@Processor('email')
export class EmailProcessor {
  private readonly logger = new Logger(EmailProcessor.name);

  @Process('send-email')
  async handleSendEmail(job: Job) {
    const { template, to, subject, data } = job.data;

    this.logger.log(
      `Sending email: template=${template}, to=${to}, subject=${subject}`,
    );

    // In production, this would integrate with a notification provider
    // (e.g., AWS SES, SendGrid). For now, log the email details.
    this.logger.log(`Email data: ${JSON.stringify(data)}`);

    return { sent: true, template, to };
  }
}
