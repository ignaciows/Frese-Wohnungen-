/**
 * Distance helpers. Only used when we have coordinates for BOTH the workplace
 * and the listing. Missing coordinates result in a null return everywhere in
 * the app — never "0" and never silently dropped.
 */

const EARTH_RADIUS_KM = 6371.0088;

export function haversineKm(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number },
): number {
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.sin(dLon / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h));
}

/**
 * Coarse straight-line-to-commute estimate. Real routing services do a better
 * job; when one is configured we use it and this function is not called.
 *
 *  car:               ~55 km/h effective (traffic + intersections)
 *  public_transport:  ~30 km/h effective
 *  bike:              ~18 km/h
 *  walk:              ~5  km/h
 */
export function estimateCommuteMinutes(distanceKm: number, mode: 'CAR' | 'PUBLIC_TRANSPORT' | 'BIKE' | 'WALK'): number {
  const kmh = mode === 'CAR' ? 55 : mode === 'PUBLIC_TRANSPORT' ? 30 : mode === 'BIKE' ? 18 : 5;
  return Math.round((distanceKm / kmh) * 60);
}
