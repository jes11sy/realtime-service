import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Req,
  ParseIntPipe,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { NotificationsService } from './notifications.service';
import { CookieJwtAuthGuard } from '../auth/guards/cookie-jwt-auth.guard';
import {
  CreateNotificationDto,
  NotifyUsersDto,
  NotifyRoomDto,
  MarkAsReadDto,
  NotifyOperatorCallDto,
  NotifyOperatorOrderDto,
  NotifyDirectorsByCityDto,
  NotifyMasterDto,
} from './dto/notification.dto';

@ApiTags('Notifications')
@Controller('api/v1/notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  /**
   * Получить уведомления текущего пользователя
   */
  @Get()
  @UseGuards(CookieJwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Получить уведомления текущего пользователя' })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: 'Лимит (по умолчанию 20)' })
  @ApiQuery({ name: 'offset', required: false, type: Number, description: 'Смещение (по умолчанию 0)' })
  @ApiResponse({ status: 200, description: 'Список уведомлений' })
  async getMyNotifications(
    @Req() req: any,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const userId = req.user.userId;
    const notifications = await this.notificationsService.getNotifications(
      userId,
      limit ? parseInt(limit, 10) : 20,
      offset ? parseInt(offset, 10) : 0,
    );
    const unreadCount = await this.notificationsService.getUnreadCount(userId);

    return {
      success: true,
      data: {
        notifications,
        unreadCount,
      },
    };
  }

  /**
   * Получить количество непрочитанных уведомлений
   */
  @Get('unread-count')
  @UseGuards(CookieJwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Получить количество непрочитанных уведомлений' })
  @ApiResponse({ status: 200, description: 'Количество непрочитанных' })
  async getUnreadCount(@Req() req: any) {
    const userId = req.user.userId;
    const count = await this.notificationsService.getUnreadCount(userId);

    return {
      success: true,
      data: { unreadCount: count },
    };
  }

  /**
   * Отметить уведомление как прочитанное
   */
  @Post('read')
  @UseGuards(CookieJwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Отметить уведомление как прочитанное' })
  @ApiResponse({ status: 200, description: 'Уведомление отмечено как прочитанное' })
  async markAsRead(@Req() req: any, @Body() dto: MarkAsReadDto) {
    const userId = req.user.userId;
    const success = await this.notificationsService.markAsRead(userId, dto.notificationId);

    return {
      success,
      message: success ? 'Notification marked as read' : 'Notification not found',
    };
  }

  /**
   * Отметить все уведомления как прочитанные
   */
  @Post('read-all')
  @UseGuards(CookieJwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Отметить все уведомления как прочитанные' })
  @ApiResponse({ status: 200, description: 'Все уведомления отмечены как прочитанные' })
  async markAllAsRead(@Req() req: any) {
    const userId = req.user.userId;
    const success = await this.notificationsService.markAllAsRead(userId);

    return {
      success,
      message: success ? 'All notifications marked as read' : 'Failed to mark all as read',
    };
  }

  /**
   * Удалить уведомление
   */
  @Delete(':notificationId')
  @UseGuards(CookieJwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Удалить уведомление' })
  @ApiResponse({ status: 200, description: 'Уведомление удалено' })
  async deleteNotification(@Req() req: any, @Param('notificationId') notificationId: string) {
    const userId = req.user.userId;
    const success = await this.notificationsService.deleteNotification(userId, notificationId);

    return {
      success,
      message: success ? 'Notification deleted' : 'Notification not found',
    };
  }

  /**
   * Очистить все уведомления
   */
  @Delete()
  @UseGuards(CookieJwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Очистить все уведомления' })
  @ApiResponse({ status: 200, description: 'Все уведомления удалены' })
  async clearAll(@Req() req: any) {
    const userId = req.user.userId;
    const success = await this.notificationsService.clearAll(userId);

    return {
      success,
      message: success ? 'All notifications cleared' : 'Failed to clear notifications',
    };
  }

  // ============ Internal API (для других сервисов) ============

  /**
   * Создать уведомление для пользователя (internal)
   */
  @Post('internal/create')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Создать уведомление (internal API)' })
  @ApiResponse({ status: 201, description: 'Уведомление создано' })
  async createNotification(@Body() dto: CreateNotificationDto) {
    const notification = await this.notificationsService.createNotification(dto);

    return {
      success: !!notification,
      data: notification,
    };
  }

  /**
   * Отправить уведомление нескольким пользователям (internal)
   */
  @Post('internal/notify-users')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Отправить уведомление нескольким пользователям (internal API)' })
  @ApiResponse({ status: 200, description: 'Уведомления отправлены' })
  async notifyUsers(@Body() dto: NotifyUsersDto) {
    await this.notificationsService.notifyUsers(
      dto.userIds,
      dto.type,
      dto.title,
      dto.message,
      dto.orderId,
      dto.data,
    );

    return {
      success: true,
      message: `Notifications sent to ${dto.userIds.length} users`,
    };
  }

  /**
   * Отправить уведомление всем в комнате (internal)
   */
  @Post('internal/notify-room')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Отправить уведомление всем в комнате (internal API)' })
  @ApiResponse({ status: 200, description: 'Уведомления отправлены' })
  async notifyRoom(@Body() dto: NotifyRoomDto) {
    await this.notificationsService.notifyRoom(
      dto.room,
      dto.type,
      dto.title,
      dto.message,
      dto.orderId,
      dto.data,
    );

    return {
      success: true,
      message: `Notifications sent to room: ${dto.room}`,
    };
  }

  // ============ Специализированные endpoints для разных ролей ============

  /**
   * КЦ: Уведомление о звонке (internal)
   */
  @Post('internal/operator/call')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Уведомить оператора о звонке (internal API)' })
  @ApiResponse({ status: 200, description: 'Уведомление отправлено' })
  async notifyOperatorCall(@Body() dto: NotifyOperatorCallDto) {
    // Определяем тип звонка из callDirection или callType
    const callType = dto.callType || (dto.callDirection === 'inbound' ? 'call_incoming' : 'call_incoming');
    // Используем phoneClient или phone
    const phone = dto.phoneClient || dto.phone || 'Неизвестный номер';
    
    const notification = await this.notificationsService.notifyOperatorCall(
      dto.operatorId,
      callType,
      phone,
      dto.clientName,
      dto.callId,
      dto.city,
      dto.avitoName,
    );

    return {
      success: !!notification,
      data: notification,
    };
  }

  /**
   * КЦ: Уведомление о заказе (internal)
   */
  @Post('internal/operator/order')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Уведомить оператора о заказе (internal API)' })
  @ApiResponse({ status: 200, description: 'Уведомление отправлено' })
  async notifyOperatorOrder(@Body() dto: NotifyOperatorOrderDto) {
    const notification = await this.notificationsService.notifyOperatorOrder(
      dto.operatorId,
      dto.actionType,
      dto.orderId,
      dto.clientName,
    );

    return {
      success: !!notification,
      data: notification,
    };
  }

  /**
   * Директор: Уведомление по городу (internal)
   */
  @Post('internal/directors/city')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Уведомить директоров города (internal API)' })
  @ApiResponse({ status: 200, description: 'Уведомления отправлены' })
  async notifyDirectorsByCity(@Body() dto: NotifyDirectorsByCityDto) {
    await this.notificationsService.notifyDirectorsByCity(
      dto.city,
      dto.notificationType,
      dto.orderId,
      dto.clientName,
      dto.masterName,
      dto.data,
    );

    return {
      success: true,
      message: `Notifications sent to directors of ${dto.city}`,
    };
  }

  /**
   * Мастер: Уведомление (internal)
   */
  @Post('internal/master')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Уведомить мастера (internal API)' })
  @ApiResponse({ status: 200, description: 'Уведомление отправлено' })
  async notifyMaster(@Body() dto: NotifyMasterDto) {
    const notification = await this.notificationsService.notifyMaster(
      dto.odooMasterId,
      dto.notificationType,
      dto.orderId,
      {
        clientName: dto.clientName,
        address: dto.address,
        dateMeeting: dto.dateMeeting,
        newDate: dto.newDate,
        reason: dto.reason,
      },
    );

    return {
      success: !!notification,
      data: notification,
    };
  }

  /**
   * Системное уведомление по роли (internal)
   */
  @Post('internal/system')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Системное уведомление по роли (internal API)' })
  @ApiResponse({ status: 200, description: 'Уведомления отправлены' })
  async notifyByRole(
    @Body() dto: { role: 'operator' | 'director' | 'master' | 'all'; title: string; message: string; data?: Record<string, any> },
  ) {
    await this.notificationsService.notifyByRole(
      dto.role,
      dto.title,
      dto.message,
      dto.data,
    );

    return {
      success: true,
      message: `System notification sent to ${dto.role} users`,
    };
  }
}
