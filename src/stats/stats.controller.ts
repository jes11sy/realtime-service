import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { StatsService } from './stats.service';

@ApiTags('stats')
@Controller('stats')
export class StatsController {
  constructor(private statsService: StatsService) {}

  @Get('connections')
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get active connections' })
  async getConnections() {
    return this.statsService.getConnections();
  }

  @Get('rooms')
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get rooms information' })
  async getRooms() {
    return this.statsService.getRooms();
  }

  @Get('health')
  @ApiOperation({ summary: 'Health check' })
  async health() {
    return this.statsService.getHealth();
  }
}

