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
      const token = this.extractTokenFromHandshake(client);

      if (!token) {
        throw new WsException('Missing authentication token');
      }

      const payload = this.jwtService.verify(token);
      client.data.user = {
        userId: payload.sub || payload.userId,
        login: payload.login,
        role: payload.role,
      };

      return true;
    } catch (error) {
      this.logger.error(`Authentication failed: ${error.message}`);
      throw new WsException('Invalid authentication token');
    }
  }

  private extractTokenFromHandshake(client: Socket): string | null {
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
}

