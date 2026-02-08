import {
  Controller,
  Post,
  Get,
  Patch,
  Body,
  UseGuards,
  Req,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsOptional, IsBoolean, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { CookieJwtAuthGuard } from '../auth/guards/cookie-jwt-auth.guard';
import { PushService, PushSubscription, UserPushSettings } from './push.service';

interface AuthRequest {
  user: {
    sub: number;
    odoo_id: number;
    role: string;
  };
}

// DTO для ключей подписки
class PushKeysDto {
  @IsString()
  @IsNotEmpty()
  p256dh: string;

  @IsString()
  @IsNotEmpty()
  auth: string;
}

// DTO для объекта подписки
class PushSubscriptionDto {
  @IsString()
  @IsNotEmpty()
  endpoint: string;

  @ValidateNested()
  @Type(() => PushKeysDto)
  keys: PushKeysDto;

  @IsOptional()
  expirationTime?: number | null;
}

// Основной DTO для подписки
class SubscribeDto {
  @ValidateNested()
  @Type(() => PushSubscriptionDto)
  subscription: PushSubscriptionDto;
}

class UnsubscribeDto {
  @IsString()
  @IsNotEmpty()
  endpoint: string;
}

class UpdateSettingsDto {
  @IsOptional()
  @IsBoolean()
  callIncoming?: boolean;

  @IsOptional()
  @IsBoolean()
  callMissed?: boolean;
}

@ApiTags('Push Notifications')
@Controller('push')
@UseGuards(CookieJwtAuthGuard)
@ApiBearerAuth()
export class PushController {
  constructor(private readonly pushService: PushService) {}

  @Post('subscribe')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Подписаться на push-уведомления' })
  async subscribe(
    @Req() req: AuthRequest,
    @Body() dto: SubscribeDto,
  ) {
    const userId = req.user.odoo_id || req.user.sub;
    
    const success = await this.pushService.saveSubscription(userId, dto.subscription);
    
    return {
      success,
      message: success ? 'Подписка сохранена' : 'Ошибка сохранения подписки',
    };
  }

  @Post('unsubscribe')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Отписаться от push-уведомлений' })
  async unsubscribe(
    @Req() req: AuthRequest,
    @Body() dto: UnsubscribeDto,
  ) {
    const userId = req.user.odoo_id || req.user.sub;
    
    const success = await this.pushService.removeSubscription(userId, dto.endpoint);
    
    return {
      success,
      message: success ? 'Подписка удалена' : 'Ошибка удаления подписки',
    };
  }

  @Get('settings')
  @ApiOperation({ summary: 'Получить настройки push-уведомлений' })
  async getSettings(@Req() req: AuthRequest) {
    const userId = req.user.odoo_id || req.user.sub;
    
    const settings = await this.pushService.getSettings(userId);
    
    return {
      success: true,
      data: settings,
    };
  }

  @Patch('settings')
  @ApiOperation({ summary: 'Обновить настройки push-уведомлений' })
  async updateSettings(
    @Req() req: AuthRequest,
    @Body() dto: UpdateSettingsDto,
  ) {
    const userId = req.user.odoo_id || req.user.sub;
    
    const success = await this.pushService.updateSettings(userId, dto);
    
    return {
      success,
      message: success ? 'Настройки обновлены' : 'Ошибка обновления настроек',
    };
  }

  @Post('test')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Отправить тестовое push-уведомление' })
  async sendTest(@Req() req: AuthRequest) {
    const userId = req.user.odoo_id || req.user.sub;
    
    const success = await this.pushService.sendTestPush(userId);
    
    return {
      success,
      message: success ? 'Тестовое уведомление отправлено' : 'Не удалось отправить (нет подписки или push отключен)',
    };
  }
}
