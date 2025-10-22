import { IsString, IsNumber, IsOptional, IsArray, IsObject } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class BroadcastCallDto {
  @ApiProperty()
  @IsString()
  token: string;

  @ApiProperty()
  @IsObject()
  call: {
    id: number;
    callId?: string;
    phoneClient: string;
    phoneOperator?: string;
    direction?: string;
    callDate?: string;
    duration?: number;
    status: string;
    recordUrl?: string;
    recordingPath?: string;
    operatorId?: number;
    orderId?: number;
  };

  @ApiProperty({ required: false })
  @IsArray()
  @IsOptional()
  rooms?: string[];
}

export class BroadcastOrderDto {
  @ApiProperty()
  @IsString()
  token: string;

  @ApiProperty()
  @IsObject()
  order: {
    id: number;
    rk?: string;
    city: string;
    phone: string;
    clientName: string;
    address?: string;
    dateMeeting?: string;
    typeEquipment?: string;
    problem?: string;
    statusOrder: string;
    masterId?: number;
    result?: number;
    operatorNameId?: number;
  };

  @ApiProperty({ required: false })
  @IsArray()
  @IsOptional()
  rooms?: string[];
}

export class BroadcastNotificationDto {
  @ApiProperty()
  @IsString()
  token: string;

  @ApiProperty()
  @IsObject()
  notification: {
    type: string;
    message: string;
    severity?: 'info' | 'warning' | 'error' | 'success';
    data?: any;
  };

  @ApiProperty({ required: false })
  @IsNumber()
  @IsOptional()
  userId?: number;

  @ApiProperty({ required: false })
  @IsArray()
  @IsOptional()
  rooms?: string[];
}

