import { IsInt, IsOptional, IsUrl, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateShortUrlDto {
  @ApiProperty({ example: 'https://example.com/some/long/path' })
  @IsUrl()
  longUrl: string;

  @ApiPropertyOptional({
    example: 3600,
    description:
      'TTL in seconds. Capped at 24h (86400) even if a larger value is sent.',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  ttl?: number;
}
