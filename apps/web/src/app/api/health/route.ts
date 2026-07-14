import { createWebProbeResponse } from '../probe-response';

export function GET(request: Request) {
  return createWebProbeResponse(request, 'ok');
}
