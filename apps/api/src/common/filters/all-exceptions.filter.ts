import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Response } from 'express';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>();

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      response
        .status(status)
        .json(typeof body === 'string' ? { statusCode: status, message: body } : body);
      return;
    }

    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      if (exception.code === 'P2002') {
        response.status(HttpStatus.CONFLICT).json({
          statusCode: 409,
          message: 'A record with this value already exists',
        });
        return;
      }
      if (exception.code === 'P2025') {
        response.status(HttpStatus.NOT_FOUND).json({ statusCode: 404, message: 'Not found' });
        return;
      }
      if (exception.code === 'P2003') {
        response.status(HttpStatus.CONFLICT).json({
          statusCode: 409,
          message: 'This record is still in use',
        });
        return;
      }
    }

    const message = exception instanceof Error ? exception.message : '';
    if (message.includes('row-level security') || message.includes('audit_log is append-only')) {
      response.status(HttpStatus.FORBIDDEN).json({
        statusCode: 403,
        message: 'You cannot change this record',
      });
      return;
    }
    if (message.includes('stock_levels_qty_nonnegative')) {
      response.status(HttpStatus.BAD_REQUEST).json({
        statusCode: 400,
        message: 'Stock cannot go below zero',
      });
      return;
    }

    this.logger.error(exception instanceof Error ? exception.stack : String(exception));
    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      statusCode: 500,
      message: 'Something went wrong',
    });
  }
}
