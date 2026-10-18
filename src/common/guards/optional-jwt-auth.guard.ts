import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/**
 * Like JwtAuthGuard, but anonymous requests (and invalid/expired tokens) go through with
 * `request.user = null` instead of a 401. For public routes whose response depends on the viewer.
 */
@Injectable()
export class OptionalJwtAuthGuard extends AuthGuard('jwt') {
  handleRequest<T>(_err: unknown, user: T | false): T | null {
    return user || null;
  }
}
