import { BadRequestException, ExecutionContext } from '@nestjs/common';
import { RequireApiKeyGuard } from './require-api-key.guard';

function contextWithHeader(headers: Record<string, string>): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ headers }) }),
  } as unknown as ExecutionContext;
}

describe('RequireApiKeyGuard', () => {
  const guard = new RequireApiKeyGuard();

  it('allows the request when x-api-key is present', () => {
    expect(guard.canActivate(contextWithHeader({ 'x-api-key': 'abc' }))).toBe(
      true,
    );
  });

  it('throws BadRequestException when x-api-key is missing', () => {
    expect(() => guard.canActivate(contextWithHeader({}))).toThrow(
      BadRequestException,
    );
  });
});
