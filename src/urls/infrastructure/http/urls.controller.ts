import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Response } from 'express';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { ApiHeader, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CreateShortUrlUseCase } from '../../application/use-cases/create-short-url.use-case';
import { ResolveShortUrlUseCase } from '../../application/use-cases/resolve-short-url.use-case';
import { CreateShortUrlDto } from '../../application/dtos/create-short-url.dto';
import { CreateShortUrlResponseDto } from '../../application/dtos/create-short-url-response.dto';
import { RequireApiKeyGuard } from './guards/require-api-key.guard';
import { ApiKeyThrottlerGuard } from './guards/api-key-throttler.guard';
import {
  THROTTLER_GET_IP,
  THROTTLER_POST_DAY,
  THROTTLER_POST_MINUTE,
} from './throttler.config';

@ApiTags('urls')
@Controller('urls')
export class UrlsController {
  constructor(
    private readonly createShortUrlUseCase: CreateShortUrlUseCase,
    private readonly resolveShortUrlUseCase: ResolveShortUrlUseCase,
    private readonly config: ConfigService,
  ) {}

  @Post()
  @ApiOperation({ summary: 'Create a short URL' })
  @ApiHeader({
    name: 'x-api-key',
    required: true,
    description:
      'Opaque identifier used for rate limiting (10/min, 100/day). Not validated against any store.',
  })
  @ApiResponse({
    status: 201,
    description: 'Short URL created',
    type: CreateShortUrlResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid longUrl/ttl, or missing x-api-key header',
  })
  @ApiResponse({
    status: 429,
    description: 'Rate limit exceeded (10/min or 100/day per api-key)',
  })
  @UseGuards(RequireApiKeyGuard, ApiKeyThrottlerGuard)
  @Throttle({
    [THROTTLER_POST_MINUTE]: { limit: 10, ttl: 60_000 },
    [THROTTLER_POST_DAY]: { limit: 100, ttl: 86_400_000 },
  })
  async create(
    @Body() dto: CreateShortUrlDto,
  ): Promise<CreateShortUrlResponseDto> {
    const url = await this.createShortUrlUseCase.execute(dto, new Date());
    const baseUrl = this.config.get<string>('BASE_URL');
    return {
      shortUrl: url.shortUrl,
      longUrl: url.longUrl,
      expiresAt: url.expiresAt,
      fullUrl: `${baseUrl}/api/urls/${url.shortUrl}`,
    };
  }

  @Get(':shortUrl')
  @ApiOperation({
    summary: 'Resolve a short URL and redirect to the original longUrl',
  })
  @ApiResponse({
    status: 302,
    description: 'Redirects to the original long URL',
  })
  @ApiResponse({ status: 404, description: 'shortUrl not found' })
  @ApiResponse({
    status: 410,
    description: 'shortUrl found but already expired',
  })
  @ApiResponse({
    status: 429,
    description: 'Rate limit exceeded (100/sec per IP)',
  })
  @UseGuards(ThrottlerGuard)
  @Throttle({ [THROTTLER_GET_IP]: { limit: 100, ttl: 1_000 } })
  @HttpCode(HttpStatus.FOUND)
  async resolve(
    @Param('shortUrl') shortUrl: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.resolveShortUrlUseCase.execute(
      shortUrl,
      new Date(),
    );

    if (result.status === 'NOT_FOUND') {
      throw new NotFoundException();
    }
    if (result.status === 'GONE') {
      res.status(HttpStatus.GONE);
      return;
    }

    res.redirect(HttpStatus.FOUND, result.longUrl);
  }
}
