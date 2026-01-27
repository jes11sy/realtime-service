/**
 * ✅ FIX #160: Миграция с Express на Fastify для консистентности с другими сервисами
 */
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { ValidationPipe, Logger, LogLevel } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './filters/http-exception.filter';

async function bootstrap() {
  // Логи по окружению
  const logLevels: LogLevel[] = process.env.NODE_ENV === 'production' 
    ? ['error', 'warn', 'log']
    : ['error', 'warn', 'log', 'debug'];

  // ✅ FIX #160: Используем Fastify вместо Express
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({
      trustProxy: true, // Для работы за reverse proxy (nginx)
    }),
    {
      logger: logLevels,
    }
  );

  const logger = new Logger('RealtimeService');

  // ✅ Проверка обязательных переменных окружения
  const allowedOrigins = process.env.CORS_ORIGIN?.split(',');
  if (!allowedOrigins || allowedOrigins.length === 0) {
    logger.error('❌ CRITICAL: CORS_ORIGIN must be configured!');
    throw new Error('CORS_ORIGIN is required');
  }

  // ✅ Security Headers с @fastify/helmet
  await app.register(require('@fastify/helmet'), {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        connectSrc: ["'self'", "ws:", "wss:"],
        scriptSrc: ["'self'", "'unsafe-inline'"], // для Swagger
        styleSrc: ["'self'", "'unsafe-inline'"], // для Swagger
      },
    },
    crossOriginEmbedderPolicy: false,
  });

  // ✅ HTTP Compression с @fastify/compress
  await app.register(require('@fastify/compress'), {
    global: true,
    encodings: ['gzip', 'deflate'],
  });

  // 🍪 Cookie Parser с @fastify/cookie
  await app.register(require('@fastify/cookie'), {
    secret: process.env.COOKIE_SECRET || process.env.JWT_SECRET,
    parseOptions: {},
  });
  logger.log('✅ Fastify cookie parser registered');

  // ✅ CORS с @fastify/cors
  await app.register(require('@fastify/cors'), {
    origin: allowedOrigins,
    credentials: true,
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'Accept',
      'Origin',
      'X-Use-Cookies', // 🍪 Поддержка cookie mode
    ],
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  });

  // ✅ HTTPS Enforcement в production (только для внешних запросов)
  if (process.env.NODE_ENV === 'production') {
    app.getHttpAdapter().getInstance().addHook('onRequest', (request, reply, done) => {
      const host = request.headers.host || '';
      const isInternalRequest = host.includes('realtime-service') || 
                                 host.startsWith('172.') || 
                                 host.startsWith('10.') ||
                                 host === 'localhost';
      
      const proto = request.headers['x-forwarded-proto'];
      if (!isInternalRequest && proto !== 'https') {
        reply.redirect(301, 'https://' + host + request.url);
        return;
      }
      done();
    });
  }

  // ✅ Дополнительные security headers
  app.getHttpAdapter().getInstance().addHook('onSend', (request, reply, payload, done) => {
    reply.header('X-Frame-Options', 'DENY');
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-XSS-Protection', '1; mode=block');
    reply.header('Referrer-Policy', 'strict-origin-when-cross-origin');
    done();
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
  await app.listen(port, '0.0.0.0'); // Слушаем на всех интерфейсах для Docker

  const protocol = process.env.NODE_ENV === 'production' ? 'https' : 'http';
  const wsProtocol = process.env.NODE_ENV === 'production' ? 'wss' : 'ws';

  logger.log(`🚀 Realtime Service running on ${protocol}://localhost:${port}`);
  logger.log(`🔌 WebSocket server running on ${wsProtocol}://localhost:${port}`);
  logger.log(`📡 Redis: ${process.env.REDIS_HOST || 'localhost'}:${process.env.REDIS_PORT || 6379}`);
  logger.log(`🛡️ Security: ${process.env.NODE_ENV === 'production' ? 'Production mode' : 'Development mode'}`);
  logger.log(`⚡ Platform: Fastify (migrated from Express)`);

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
