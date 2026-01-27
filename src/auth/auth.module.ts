import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { JwtStrategy } from './jwt.strategy';
import { CookieJwtAuthGuard } from './guards/cookie-jwt-auth.guard';

// Валидация JWT_SECRET при загрузке модуля
const jwtSecret = process.env.JWT_SECRET;

if (!jwtSecret) {
  throw new Error('JWT_SECRET environment variable is required');
}

if (jwtSecret.length < 32) {
  throw new Error('JWT_SECRET must be at least 32 characters long');
}

@Module({
  imports: [
    PassportModule,
    JwtModule.register({
      secret: jwtSecret,
      signOptions: { expiresIn: '24h' },
    }),
  ],
  providers: [JwtStrategy, CookieJwtAuthGuard],
  exports: [JwtModule, CookieJwtAuthGuard],
})
export class AuthModule {}

