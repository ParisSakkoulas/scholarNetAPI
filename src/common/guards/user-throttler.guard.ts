import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

/** Rate limits count per signed-in user (this guard runs after JwtAuthGuard), not per IP. */
@Injectable()
export class UserThrottlerGuard extends ThrottlerGuard {
  protected getTracker(req: Record<string, any>): Promise<string> {
    return Promise.resolve(String(req.user?.userId ?? req.ip));
  }
}
