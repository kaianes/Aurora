import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Response } from 'express';

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    if (!(exception instanceof HttpException) || exception.getStatus() >= 500) {
      this.logger.error(
        exception instanceof Error ? exception.message : String(exception),
        exception instanceof Error ? exception.stack : undefined,
      );
    }

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let errorResponse: any = {
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Ocorreu um erro interno. Tente novamente mais tarde.',
        details: {},
      },
    };

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const exResponse = exception.getResponse();

      if (typeof exResponse === 'object' && (exResponse as any).error) {
        errorResponse = exResponse;
      } else if (typeof exResponse === 'object') {
        const r = exResponse as any;
        errorResponse = {
          error: {
            code: r.code || 'ERROR',
            message: r.message || exception.message,
            details: r.details || {},
          },
        };
      } else {
        errorResponse = {
          error: {
            code: 'ERROR',
            message: String(exResponse),
            details: {},
          },
        };
      }
    }

    response.status(status).json(errorResponse);
  }
}
