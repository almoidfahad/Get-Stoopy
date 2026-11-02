import { assertRoadRouteMatrix, type RoadRouteElement, type RoadRoutePoint } from '@getstoopy/core';

export type RoadTravelMode = 'BICYCLE' | 'TWO_WHEELER' | 'DRIVE';
export interface RoadRouteMatrixInput { origins: RoadRoutePoint[]; destinations: RoadRoutePoint[]; travelMode: RoadTravelMode; }
export interface RoadRouteMatrixResult { provider: string; mode: 'TEST_ONLY' | 'GOOGLE_ROUTES'; elements: RoadRouteElement[]; }
export interface RoadRouteMatrixPort { computeMatrix(input: RoadRouteMatrixInput): Promise<RoadRouteMatrixResult>; }

export class DisabledRoadRouteMatrix implements RoadRouteMatrixPort {
  async computeMatrix(_input: RoadRouteMatrixInput): Promise<RoadRouteMatrixResult> { throw new Error('ROAD_ROUTING_DISABLED'); }
}

/** Google Routes Route Matrix adapter. Live paid calls are disabled by config; tests may point at a local stub. */
export class GoogleRoutesRoadRouteMatrix implements RoadRouteMatrixPort {
  constructor(private readonly opts: { apiKey: string; baseUrl: string; testMode: boolean; fetchImpl?: typeof fetch; timeoutMs?: number }) {}
  async computeMatrix(input: RoadRouteMatrixInput): Promise<RoadRouteMatrixResult> {
    if (input.origins.length < 1 || input.origins.length > 25 || input.destinations.length < 1 || input.destinations.length > 25) throw new Error('ROAD_ROUTE_MATRIX_SIZE_INVALID');
    const body = {
      origins: input.origins.map(p => ({ waypoint: { location: { latLng: { latitude: p.latitude, longitude: p.longitude } } } })),
      destinations: input.destinations.map(p => ({ waypoint: { location: { latLng: { latitude: p.latitude, longitude: p.longitude } } } })),
      travelMode: input.travelMode,
      routingPreference: 'TRAFFIC_UNAWARE'
    };
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.opts.timeoutMs ?? 5000);
    try {
      const fetchImpl = this.opts.fetchImpl ?? fetch;
      const res = await fetchImpl(`${this.opts.baseUrl.replace(/\/$/, '')}/distanceMatrix/v2:computeRouteMatrix`, {
        method: 'POST', signal: controller.signal,
        headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': this.opts.apiKey, 'X-Goog-FieldMask': 'originIndex,destinationIndex,distanceMeters,duration,condition' },
        body: JSON.stringify(body)
      });
      if (!res.ok) throw new Error('ROAD_ROUTE_PROVIDER_ERROR');
      const data = await res.json() as any[];
      if (!Array.isArray(data)) throw new Error('ROAD_ROUTE_RESPONSE_INVALID');
      const elements: RoadRouteElement[] = data.map(e => ({
        originIndex: e.originIndex ?? -1,
        destinationIndex: e.destinationIndex ?? -1,
        distanceMeters: typeof e.distanceMeters === 'number' ? e.distanceMeters : -1,
        durationSeconds: typeof e.duration === 'string' && /^\d+(\.\d+)?s$/.test(e.duration) ? Math.round(Number(e.duration.slice(0, -1))) : null,
        condition: typeof e.condition === 'string' ? e.condition : 'UNKNOWN'
      }));
      assertRoadRouteMatrix(elements, input.origins.length, input.destinations.length);
      return { provider: this.opts.testMode ? 'google-routes-test-stub' : 'google-routes', mode: this.opts.testMode ? 'TEST_ONLY' : 'GOOGLE_ROUTES', elements };
    } catch (e: any) {
      if (e?.name === 'AbortError') throw new Error('ROAD_ROUTE_TIMEOUT');
      throw e instanceof Error ? e : new Error('ROAD_ROUTE_PROVIDER_ERROR');
    } finally { clearTimeout(timeout); }
  }
}
