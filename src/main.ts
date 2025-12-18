import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger, LogLevel } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module';
import * as compression from 'compression';
import helmet from 'helmet';
import { AllExceptionsFilter } from './filters/http-exception.filter';

async function bootstrap() {
  // Логи по окружению
  const logLevels: LogLevel[] = process.env.NODE_ENV === 'production' 
    ? ['error', 'warn', 'log']
    : ['error', 'warn', 'log', 'debug'];

  const app = await NestFactory.create(AppModule, {
    logger: logLevels,
  });

  const logger = new Logger('RealtimeService');

  // ✅ Проверка обязательных переменных окружения
  const allowedOrigins = process.env.CORS_ORIGIN?.split(',');
  if (!allowedOrigins || allowedOrigins.length === 0) {
    logger.error('❌ CRITICAL: CORS_ORIGIN must be configured!');
    throw new Error('CORS_ORIGIN is required');
  }

  // ✅ HTTPS Enforcement в production (ТОЛЬКО для внешних запросов через Nginx)
  if (process.env.NODE_ENV === 'production') {
    app.use((req, res, next) => {
      // Разрешить HTTP для внутренних микросервисов (Docker network)
      const isInternalRequest = req.get('host')?.includes('realtime-service') || 
                                req.ip?.startsWith('172.') || 
                                req.ip === '::ffff:172.18.0.';
      
      if (!isInternalRequest && !req.secure && req.get('x-forwarded-proto') !== 'https') {
        return res.redirect(301, 'https://' + req.get('host') + req.url);
      }
      next();
    });
  }

  // ✅ Security Headers с Helmet
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        connectSrc: ["'self'", "ws:", "wss:"],
        scriptSrc: ["'self'", "'unsafe-inline'"], // для Swagger
        styleSrc: ["'self'", "'unsafe-inline'"], // для Swagger
      },
    },
    crossOriginEmbedderPolicy: false,
  }));

  // ✅ Дополнительные security headers
  app.use((req, res, next) => {
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    next();
  });

  // ✅ HTTP Compression
  app.use(compression());

  app.enableCors({
    origin: allowedOrigins,
    credentials: true,
  });

  // ✅ Глобальный обработчик ошибок
  app.useGlobalFilters(new AllExceptionsFilter());

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  );

  // ✅ Swagger только в development
  if (process.env.NODE_ENV !== 'production') {
    const config = new DocumentBuilder()
      .setTitle('Realtime Service API')
      .setDescription('WebSocket real-time events with Socket.IO')
      .setVersion('1.0')
      .addBearerAuth()
      .build();

    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('api/docs', app, document);
    logger.log('📚 Swagger available at /api/docs');
  }

  app.setGlobalPrefix('api/v1');

  // ✅ Graceful shutdown
  app.enableShutdownHooks();

  const port = process.env.PORT || 5009;
  await app.listen(port);

  const protocol = process.env.NODE_ENV === 'production' ? 'https' : 'http';
  const wsProtocol = process.env.NODE_ENV === 'production' ? 'wss' : 'ws';

  logger.log(`🚀 Realtime Service running on ${protocol}://localhost:${port}`);
  logger.log(`🔌 WebSocket server running on ${wsProtocol}://localhost:${port}`);
  logger.log(`📡 Redis: ${process.env.REDIS_HOST || 'localhost'}:${process.env.REDIS_PORT || 6379}`);
  logger.log(`🛡️ Security: ${process.env.NODE_ENV === 'production' ? 'Production mode' : 'Development mode'}`);

  // ✅ Graceful shutdown handlers
  const shutdownHandler = async (signal: string) => {
    logger.log(`Received ${signal}, closing gracefully...`);
    try {
      await app.close();
      logger.log('✅ Application closed gracefully');
      process.exit(0);
    } catch (error) {
      logger.error('❌ Error during shutdown:', error);
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => shutdownHandler('SIGTERM'));
  process.on('SIGINT', () => shutdownHandler('SIGINT'));
}

bootstrap().catch((err) => {
  const logger = new Logger('Bootstrap');
  logger.error('❌ Failed to start application:', err);
  process.exit(1);
});

