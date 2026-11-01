import { loadApiEnv, type ApiEnv } from '@getstoopy/config';
export const ENV = Symbol('ENV');
export function provideEnv(): { provide: typeof ENV; useValue: ApiEnv } {
  return { provide: ENV, useValue: loadApiEnv(process.env) };
}
