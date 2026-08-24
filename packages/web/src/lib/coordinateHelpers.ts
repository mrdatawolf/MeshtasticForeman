/** Calculate a spherical destination point and normalize longitude across the antimeridian. */
export function destinationPoint(
  lat: number,
  lon: number,
  bearingDeg: number,
  distKm: number,
): { lat: number; lon: number } {
  const radiusKm = 6371;
  const angularDistance = distKm / radiusKm;
  const sourceLat = (lat * Math.PI) / 180;
  const sourceLon = (lon * Math.PI) / 180;
  const bearing = (bearingDeg * Math.PI) / 180;
  const destinationLat = Math.asin(
    Math.sin(sourceLat) * Math.cos(angularDistance) +
      Math.cos(sourceLat) * Math.sin(angularDistance) * Math.cos(bearing),
  );
  const destinationLon =
    sourceLon +
    Math.atan2(
      Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(sourceLat),
      Math.cos(angularDistance) - Math.sin(sourceLat) * Math.sin(destinationLat),
    );
  return {
    lat: (destinationLat * 180) / Math.PI,
    lon: (((destinationLon * 180) / Math.PI + 540) % 360) - 180,
  };
}

export function clipViewshedToRadius(
  polygon: GeoJSON.Feature<GeoJSON.Polygon>,
  sourceLat: number,
  sourceLon: number,
  maxRadiusKm: number,
): GeoJSON.Feature<GeoJSON.Polygon> {
  const radiusKm = 6371;
  const ring = polygon.geometry.coordinates[0];
  const clipped = ring.map(([lon, lat]): [number, number] => {
    const dLat = ((lat - sourceLat) * Math.PI) / 180;
    const dLon = ((lon - sourceLon) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos((sourceLat * Math.PI) / 180) *
        Math.cos((lat * Math.PI) / 180) *
        Math.sin(dLon / 2) ** 2;
    const distanceKm = radiusKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    if (distanceKm <= maxRadiusKm) return [lon, lat];
    const firstLat = (sourceLat * Math.PI) / 180;
    const secondLat = (lat * Math.PI) / 180;
    const deltaLon = ((lon - sourceLon) * Math.PI) / 180;
    const bearing =
      (Math.atan2(
        Math.sin(deltaLon) * Math.cos(secondLat),
        Math.cos(firstLat) * Math.sin(secondLat) -
          Math.sin(firstLat) * Math.cos(secondLat) * Math.cos(deltaLon),
      ) *
        180) /
      Math.PI;
    const point = destinationPoint(sourceLat, sourceLon, bearing, maxRadiusKm);
    return [point.lon, point.lat];
  });
  return { ...polygon, geometry: { type: "Polygon", coordinates: [clipped] } };
}

/** Approximate a LoRa-scale geodesic circle using the page's equirectangular conversion. */
export function buildCoverageCircle(
  lon: number,
  lat: number,
  radiusKm: number,
  color: string,
  steps = 64,
  focused = false,
): GeoJSON.Feature<GeoJSON.Polygon> {
  const latRad = (lat * Math.PI) / 180;
  const dLat = radiusKm / 110.574;
  const dLon = radiusKm / (111.32 * Math.cos(latRad));
  const coords: [number, number][] = [];
  for (let index = 0; index <= steps; index++) {
    const angle = (index / steps) * 2 * Math.PI;
    coords.push([lon + dLon * Math.cos(angle), lat + dLat * Math.sin(angle)]);
  }
  return {
    type: "Feature",
    properties: { color, focused: focused ? 1 : 0 },
    geometry: { type: "Polygon", coordinates: [coords] },
  };
}
