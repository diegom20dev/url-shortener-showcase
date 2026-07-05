export interface UrlProps {
  id: number;
  shortUrl: string;
  longUrl: string;
  createdAt: Date;
  expiresAt: Date | null;
}

export class Url {
  constructor(private readonly props: UrlProps) {}

  get id(): number {
    return this.props.id;
  }

  get shortUrl(): string {
    return this.props.shortUrl;
  }

  get longUrl(): string {
    return this.props.longUrl;
  }

  get createdAt(): Date {
    return this.props.createdAt;
  }

  get expiresAt(): Date | null {
    return this.props.expiresAt;
  }

  isExpired(now: Date): boolean {
    return (
      this.props.expiresAt !== null &&
      this.props.expiresAt.getTime() < now.getTime()
    );
  }
}
