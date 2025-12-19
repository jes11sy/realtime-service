import { Injectable, ExecutionContext, UnauthorizedException, Logger } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { CookieConfig } from '../../config/cookie.config';
import { Request } from 'express';

/**
 * 🍪 COOKIE JWT AUTH GUARD (для Express)
 * 
 * Guard для извлечения JWT токенов из httpOnly cookies
 * Если токен найден в cookie, он добавляется в Authorization header
 * для дальнейшей обработки стандартным JwtStrategy
 */
@Injectable()
export class CookieJwtAuthGuard extends AuthGuard('jwt') {
  private readonly logger = new Logger(CookieJwtAuthGuard.name);

  canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<Request>();
    
    // Пытаемся получить токен из cookies (Express + cookie-parser)
    let cookieToken: string | null = null;
    
    if (request.cookies && CookieConfig.ENABLE_COOKIE_SIGNING && request.signedCookies) {
      // Подписанный cookie
      cookieToken = request.signedCookies[CookieConfig.ACCESS_TOKEN_NAME] || null;
      
      if (!cookieToken && request.cookies[CookieConfig.ACCESS_TOKEN_NAME]) {
        this.logger.warn('⚠️ Invalid access token signature. Possible tampering.');
        throw new UnauthorizedException('Invalid access token signature. Possible tampering.');
      }
    } else if (request.cookies) {
      // Неподписанный cookie
      cookieToken = request.cookies[CookieConfig.ACCESS_TOKEN_NAME] || null;
    }
    
    // Если токен найден в cookie и нет Authorization header, добавляем его
    if (cookieToken && !request.headers.authorization) {
      request.headers.authorization = `Bearer ${cookieToken}`;
      this.logger.debug('✅ Token extracted from httpOnly cookie');
    }
    
    // Вызываем стандартную JWT валидацию
    return super.canActivate(context);
  }

  handleRequest(err: any, user: any, info: any) {
    if (err || !user) {
      if (info?.name === 'TokenExpiredError') {
        throw new UnauthorizedException('Access token has expired. Please refresh your token.');
      }
      if (info?.name === 'JsonWebTokenError') {
        throw new UnauthorizedException('Invalid access token.');
      }
      throw err || new UnauthorizedException('Authentication required.');
    }
    return user;
  }
}

