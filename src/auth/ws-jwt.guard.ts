import { Injectable, CanActivate, ExecutionContext, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { WsException } from '@nestjs/websockets';
import { Socket } from 'socket.io';

@Injectable()
export class WsJwtGuard implements CanActivate {
  private readonly logger = new Logger(WsJwtGuard.name);

  constructor(private jwtService: JwtService) {}

  canActivate(context: ExecutionContext): boolean {
    try {
      const client: Socket = context.switchToWs().getClient();
      const data = context.switchToWs().getData();
      
      this.logger.debug(`🔍 [WsJwtGuard] Checking authentication for client ${client.id}`);
      
      // ✅ Если клиент уже аутентифицирован, разрешаем операцию
      if (client.data.user) {
        this.logger.debug(`✅ User already authenticated: ${client.data.user.userId}`);
        return true;
      }
      
      // Сначала проверяем токен из события (для authenticate)
      let token = data?.token;
      this.logger.debug(`🔍 [WsJwtGuard] Token from event data: ${token ? 'Present' : 'Missing'}`);
      
      // Если нет в событии, проверяем handshake
      if (!token) {
        token = this.extractTokenFromHandshake(client);
        this.logger.debug(`🔍 [WsJwtGuard] Token from handshake: ${token ? 'Present' : 'Missing'}`);
      }

      if (!token) {
        this.logger.warn(`❌ Missing authentication token for client ${client.id}`);
        client.emit('error', { message: 'Missing authentication token' });
        throw new WsException('Missing authentication token');
      }

      this.logger.debug(`🔍 [WsJwtGuard] Verifying token for client ${client.id}`);
      const payload = this.jwtService.verify(token);
      // ✅ Не логируем payload - содержит чувствительные данные
      
      client.data.user = {
        userId: payload.sub || payload.userId,
        login: payload.login,
        role: payload.role,
      };

      this.logger.log(`✅ User authenticated: ${payload.sub || payload.userId} (${payload.role})`);
      return true;
    } catch (error: any) {
      this.logger.error(`❌ Authentication failed for client ${context.switchToWs().getClient().id}: ${error.message}`);
      context.switchToWs().getClient().emit('error', { message: `Authentication failed: ${error.message}` });
      throw new WsException('Invalid authentication token');
    }
  }

  private extractTokenFromHandshake(client: Socket): string | null {
    // 🍪 ПРИОРИТЕТ 1: Проверяем httpOnly cookies (для новой системы аутентификации)
    const cookies = client.handshake?.headers?.cookie;
    if (cookies) {
      const cookieToken = this.extractTokenFromCookies(cookies);
      if (cookieToken) {
        this.logger.debug(`🍪 Token extracted from cookies`);
        return cookieToken;
      }
    }

    // Проверяем auth объект
    if (client.handshake?.auth?.token) {
      return client.handshake.auth.token;
    }

    // Проверяем query параметры
    if (client.handshake?.query?.token) {
      return client.handshake.query.token as string;
    }

    // Проверяем headers
    const authHeader = client.handshake?.headers?.authorization;
    if (authHeader) {
      const [type, token] = authHeader.split(' ');
      if (type === 'Bearer' && token) {
        return token;
      }
    }

    return null;
  }

  // 🍪 Извлечение токена из cookies
  private extractTokenFromCookies(cookieHeader: string): string | null {
    try {
      // Парсим cookie строку
      const cookies = cookieHeader.split(';').reduce((acc, cookie) => {
        const [key, value] = cookie.trim().split('=');
        acc[key] = value;
        return acc;
      }, {} as Record<string, string>);

      // Проверяем access_token (может быть с префиксом __Host-)
      const accessToken = cookies['access_token'] || cookies['__Host-access_token'];
      
      if (accessToken) {
        // Декодируем cookie value (может быть URL encoded)
        return decodeURIComponent(accessToken);
      }

      return null;
    } catch (error) {
      this.logger.error(`Error parsing cookies: ${error.message}`);
      return null;
    }
  }
}

