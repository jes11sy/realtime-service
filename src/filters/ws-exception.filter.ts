import { Catch, ArgumentsHost, HttpException, Logger } from '@nestjs/common';
import { BaseWsExceptionFilter, WsException } from '@nestjs/websockets';

@Catch()
export class WsExceptionsFilter extends BaseWsExceptionFilter {
  private readonly logger = new Logger(WsExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const client = host.switchToWs().getClient();
    
    let message = 'Internal server error';
    let statusCode = 500;

    if (exception instanceof WsException) {
      message = exception.message;
      statusCode = 400;
    } else if (exception instanceof HttpException) {
      message = exception.message;
      statusCode = exception.getStatus();
    } else if (exception instanceof Error) {
      // ✅ Не раскрываем внутренние детали ошибок
      if (process.env.NODE_ENV !== 'production') {
        message = exception.message;
      }
      this.logger.error(`WebSocket Error: ${exception.message}`, exception.stack);
    }

    // Отправляем общее сообщение клиенту
    client.emit('error', {
      statusCode,
      message,
      timestamp: new Date().toISOString(),
    });
  }
}

