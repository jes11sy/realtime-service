import { IsString, IsNumber, IsOptional, IsEnum, IsObject, IsArray } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Типы уведомлений по ролям:
 * 
 * КЦ (operator):
 * - call_incoming - входящий звонок
 * - call_missed - пропущенный звонок  
 * - order_created - заказ создан (свой)
 * - order_edited - заказ отредактирован
 * 
 * Директор:
 * - order_new - новый заказ в городе
 * - order_accepted - мастер принял заказ
 * - order_rescheduled - заказ перенесен
 * - order_rejected - заказ стал незаказом
 * - order_closed - мастер закрыл заказ
 * 
 * Мастер:
 * - master_assigned - назначен на заказ
 * - master_order_rescheduled - заказ перенесен
 * - master_order_rejected - заказ стал незаказом
 */
export enum NotificationType {
  // КЦ
  CALL_INCOMING = 'call_incoming',
  CALL_MISSED = 'call_missed',
  ORDER_CREATED = 'order_created',
  ORDER_EDITED = 'order_edited',
  
  // Директор
  ORDER_NEW = 'order_new',
  ORDER_ACCEPTED = 'order_accepted',
  ORDER_RESCHEDULED = 'order_rescheduled',
  ORDER_REJECTED = 'order_rejected',
  ORDER_CLOSED = 'order_closed',
  
  // Мастер
  MASTER_ASSIGNED = 'master_assigned',
  MASTER_ORDER_RESCHEDULED = 'master_order_rescheduled',
  MASTER_ORDER_REJECTED = 'master_order_rejected',
  
  // Общие
  SYSTEM = 'system',
}

export enum TargetRole {
  OPERATOR = 'operator',
  DIRECTOR = 'director',
  MASTER = 'master',
  ALL = 'all',
}

export class CreateNotificationDto {
  @ApiProperty({ description: 'ID пользователя' })
  @IsNumber()
  userId: number;

  @ApiProperty({ enum: NotificationType, description: 'Тип уведомления' })
  @IsEnum(NotificationType)
  type: NotificationType;

  @ApiProperty({ description: 'Заголовок уведомления' })
  @IsString()
  title: string;

  @ApiProperty({ description: 'Текст уведомления' })
  @IsString()
  message: string;

  @ApiPropertyOptional({ description: 'ID заказа (если связано с заказом)' })
  @IsOptional()
  @IsNumber()
  orderId?: number;

  @ApiPropertyOptional({ description: 'Дополнительные данные' })
  @IsOptional()
  @IsObject()
  data?: Record<string, any>;
}

export class NotifyUsersDto {
  @ApiProperty({ description: 'Массив ID пользователей', type: [Number] })
  @IsNumber({}, { each: true })
  userIds: number[];

  @ApiProperty({ enum: NotificationType, description: 'Тип уведомления' })
  @IsEnum(NotificationType)
  type: NotificationType;

  @ApiProperty({ description: 'Заголовок уведомления' })
  @IsString()
  title: string;

  @ApiProperty({ description: 'Текст уведомления' })
  @IsString()
  message: string;

  @ApiPropertyOptional({ description: 'ID заказа (если связано с заказом)' })
  @IsOptional()
  @IsNumber()
  orderId?: number;

  @ApiPropertyOptional({ description: 'Дополнительные данные' })
  @IsOptional()
  @IsObject()
  data?: Record<string, any>;
}

export class NotifyRoomDto {
  @ApiProperty({ description: 'Название комнаты (operators, directors)' })
  @IsString()
  room: string;

  @ApiProperty({ enum: NotificationType, description: 'Тип уведомления' })
  @IsEnum(NotificationType)
  type: NotificationType;

  @ApiProperty({ description: 'Заголовок уведомления' })
  @IsString()
  title: string;

  @ApiProperty({ description: 'Текст уведомления' })
  @IsString()
  message: string;

  @ApiPropertyOptional({ description: 'ID заказа (если связано с заказом)' })
  @IsOptional()
  @IsNumber()
  orderId?: number;

  @ApiPropertyOptional({ description: 'Дополнительные данные' })
  @IsOptional()
  @IsObject()
  data?: Record<string, any>;
}

// ============ Специализированные DTO для разных ролей ============

/**
 * Уведомление для КЦ о звонке
 */
export class NotifyOperatorCallDto {
  @ApiProperty({ description: 'ID оператора' })
  @IsNumber()
  operatorId: number;

  @ApiPropertyOptional({ enum: ['call_incoming', 'call_missed'], description: 'Тип звонка (legacy)' })
  @IsOptional()
  @IsString()
  callType?: 'call_incoming' | 'call_missed';

  @ApiPropertyOptional({ description: 'Номер телефона (legacy)' })
  @IsOptional()
  @IsString()
  phone?: string;

  @ApiPropertyOptional({ description: 'Номер телефона клиента' })
  @IsOptional()
  @IsString()
  phoneClient?: string;

  @ApiPropertyOptional({ description: 'Направление звонка' })
  @IsOptional()
  @IsString()
  callDirection?: 'inbound' | 'outbound' | 'callback';

  @ApiPropertyOptional({ description: 'Город' })
  @IsOptional()
  @IsString()
  city?: string;

  @ApiPropertyOptional({ description: 'Avito аккаунт' })
  @IsOptional()
  @IsString()
  avitoName?: string;

  @ApiPropertyOptional({ description: 'Имя клиента' })
  @IsOptional()
  @IsString()
  clientName?: string;

  @ApiPropertyOptional({ description: 'ID звонка' })
  @IsOptional()
  @IsNumber()
  callId?: number;
}

/**
 * Уведомление для КЦ о заказе
 */
export class NotifyOperatorOrderDto {
  @ApiProperty({ description: 'ID оператора' })
  @IsNumber()
  operatorId: number;

  @ApiProperty({ enum: ['order_created', 'order_edited'], description: 'Тип действия' })
  @IsString()
  actionType: 'order_created' | 'order_edited';

  @ApiProperty({ description: 'ID заказа' })
  @IsNumber()
  orderId: number;

  @ApiPropertyOptional({ description: 'Имя клиента' })
  @IsOptional()
  @IsString()
  clientName?: string;
}

/**
 * Уведомление для директоров по городу
 */
export class NotifyDirectorsByCityDto {
  @ApiProperty({ description: 'Город' })
  @IsString()
  city: string;

  @ApiProperty({ 
    enum: ['order_new', 'order_accepted', 'order_rescheduled', 'order_rejected', 'order_closed'], 
    description: 'Тип уведомления' 
  })
  @IsString()
  notificationType: 'order_new' | 'order_accepted' | 'order_rescheduled' | 'order_rejected' | 'order_closed';

  @ApiProperty({ description: 'ID заказа' })
  @IsNumber()
  orderId: number;

  @ApiPropertyOptional({ description: 'Имя клиента' })
  @IsOptional()
  @IsString()
  clientName?: string;

  @ApiPropertyOptional({ description: 'Имя мастера' })
  @IsOptional()
  @IsString()
  masterName?: string;

  @ApiPropertyOptional({ description: 'Дополнительные данные' })
  @IsOptional()
  @IsObject()
  data?: Record<string, any>;
}

/**
 * Уведомление для мастера
 */
export class NotifyMasterDto {
  @ApiProperty({ description: 'ID мастера (odoo)' })
  @IsNumber()
  odooMasterId: number;

  @ApiProperty({ 
    enum: ['master_assigned', 'master_order_rescheduled', 'master_order_rejected', 'master_order_reassigned'], 
    description: 'Тип уведомления' 
  })
  @IsString()
  notificationType: 'master_assigned' | 'master_order_rescheduled' | 'master_order_rejected' | 'master_order_reassigned';

  @ApiProperty({ description: 'ID заказа' })
  @IsNumber()
  orderId: number;

  @ApiPropertyOptional({ description: 'Имя клиента' })
  @IsOptional()
  @IsString()
  clientName?: string;

  @ApiPropertyOptional({ description: 'Адрес' })
  @IsOptional()
  @IsString()
  address?: string;

  @ApiPropertyOptional({ description: 'Город' })
  @IsOptional()
  @IsString()
  city?: string;

  @ApiPropertyOptional({ description: 'Дата встречи' })
  @IsOptional()
  @IsString()
  dateMeeting?: string;

  @ApiPropertyOptional({ description: 'Новая дата (для переноса)' })
  @IsOptional()
  @IsString()
  newDate?: string;

  @ApiPropertyOptional({ description: 'Причина (для незаказа)' })
  @IsOptional()
  @IsString()
  reason?: string;
}

export class MarkAsReadDto {
  @ApiProperty({ description: 'ID уведомления' })
  @IsString()
  notificationId: string;
}
