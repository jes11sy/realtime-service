import { Injectable, CanActivate, ExecutionContext, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { WsException } from '@nestjs/websockets';
import { Socket } from 'socket.io';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class WsJwtGuard implements CanActivate {
  private readonly logger = new Logger(WsJwtGuard.name);

  constructor(
    private jwtService: JwtService,
    private configService: ConfigService,
  ) {}

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

      this.logger.debug(`🔍 [WsJwtGuard] Verifying token for client ${client.id} (first 30 chars): ${token.substring(0, 30)}...`);
      const payload = this.jwtService.verify(token);
      this.logger.debug(`🔍 [WsJwtGuard] Token verified successfully. Payload sub: ${payload.sub || payload.userId}, role: ${payload.role}`);
      
      client.data.user = {
        userId: payload.sub || payload.userId,
        login: payload.login,
        role: payload.role,
      };

      this.logger.log(`✅ User authenticated: ${payload.sub || payload.userId} (${payload.role})`);
      return true;
    } catch (error: any) {
      this.logger.error(`❌ Authentication failed for client ${context.switchToWs().getClient().id}: ${error.message}`);
      this.logger.error(`❌ Error stack: ${error.stack}`);
      context.switchToWs().getClient().emit('error', { message: `Authentication failed: ${error.message}` });
      throw new WsException('Invalid authentication token');
    }
  }

  private extractTokenFromHandshake(client: Socket): string | null {
    // 🔍 ОТЛАДКА: Логируем все заголовки handshake
    this.logger.debug(`🔍 Handshake headers: ${JSON.stringify(Object.keys(client.handshake?.headers || {}))}`);
    this.logger.debug(`🔍 Handshake auth: ${JSON.stringify(client.handshake?.auth || {})}`);
    this.logger.debug(`🔍 Handshake query: ${JSON.stringify(client.handshake?.query || {})}`);
    
    // 🍪 ПРИОРИТЕТ 1: Проверяем httpOnly cookies (для новой системы аутентификации)
    const cookies = client.handshake?.headers?.cookie;
    this.logger.debug(`🍪 Cookie header present: ${cookies ? 'YES' : 'NO'}`);
    
    if (cookies) {
      const cookieToken = this.extractTokenFromCookies(cookies);
      if (cookieToken) {
        this.logger.debug(`🍪 Token extracted from cookies`);
        return cookieToken;
      }
    }

    // Проверяем auth объект
    if (client.handshake?.auth?.token) {
      this.logger.debug(`✅ Token found in auth object`);
      return client.handshake.auth.token;
    }

    // Проверяем query параметры
    if (client.handshake?.query?.token) {
      this.logger.debug(`✅ Token found in query params`);
      return client.handshake.query.token as string;
    }

    // Проверяем headers
    const authHeader = client.handshake?.headers?.authorization;
    if (authHeader) {
      const [type, token] = authHeader.split(' ');
      if (type === 'Bearer' && token) {
        this.logger.debug(`✅ Token found in Authorization header`);
        return token;
      }
    }

    this.logger.error(`❌ No token found in any location (cookies, auth, query, headers)`);
    return null;
  }

  // 🍪 Извлечение токена из cookies
  private extractTokenFromCookies(cookieHeader: string): string | null {
    try {
      this.logger.debug(`🍪 Raw cookie header: ${cookieHeader.substring(0, 100)}...`);
      
      // Парсим cookie строку
      const cookies = cookieHeader.split(';').reduce((acc, cookie) => {
        const [key, ...valueParts] = cookie.trim().split('=');
        // Join обратно на случай если в значении есть '='
        acc[key] = valueParts.join('=');
        return acc;
      }, {} as Record<string, string>);

      this.logger.debug(`🍪 Parsed cookies keys: ${Object.keys(cookies).join(', ')}`);

      // Проверяем access_token (может быть с префиксом __Host-)
      let accessToken = cookies['access_token'] || cookies['__Host-access_token'];
      
      if (accessToken) {
        this.logger.debug(`🍪 Found access token (first 20 chars): ${accessToken.substring(0, 20)}...`);
        
        // Декодируем cookie value (может быть URL encoded)
        accessToken = decodeURIComponent(accessToken);
        
        // Проверяем формат токена (JWT имеет 3 части)
        const tokenParts = accessToken.split('.');
        if (tokenParts.length === 4) {
          // Это legacy signed cookie: jwt.header.jwt.payload.jwt.signature.cookie_signature
          // Убираем 4-ю часть (cookie signature) — подпись cookies отключена
          this.logger.debug(`🔧 Stripping legacy cookie signature (4 parts → 3)`);
          accessToken = tokenParts.slice(0, 3).join('.');
        }
        
        // JWT должен иметь 3 части разделенные точками
        const parts = accessToken.split('.');
        if (parts.length !== 3) {
          this.logger.error(`🍪 Invalid JWT format: expected 3 parts, got ${parts.length}`);
          this.logger.debug(`🍪 Token value: ${accessToken.substring(0, 50)}...`);
          return null;
        }
        
        this.logger.debug(`🍪 Token successfully extracted and validated`);
        return accessToken;
      }

      this.logger.warn(`🍪 No access_token found in cookies`);
      return null;
    } catch (error) {
      this.logger.error(`🍪 Error parsing cookies: ${error.message}`);
      return null;
    }
  }

}

