import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateShortUrlResponseDto {
  @ApiProperty({ example: 'a' })
  shortUrl: string;

  @ApiProperty({ example: 'https://example.com/some/long/path' })
  longUrl: string;

  @ApiPropertyOptional({ example: '2026-07-05T00:00:00.000Z', nullable: true })
  expiresAt: Date | null;

  @ApiProperty({ example: 'http://localhost:3000/a' })
  fullUrl: string;
}
