import { IsString, Length, Matches } from 'class-validator';

export class JoinRoomDto {
  @IsString()
  @Length(1, 100)
  @Matches(/^[a-z0-9:_-]+$/i, {
    message: 'Room name can only contain alphanumeric characters, colons, underscores and hyphens',
  })
  room: string;
}

