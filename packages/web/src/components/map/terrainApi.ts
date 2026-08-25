export async function fetchElevation(lat: number, lon: number): Promise<number> {
  const response = await fetch(`/api/elevation?lat=${lat}&lon=${lon}`);
  const { elevationM } = (await response.json()) as { elevationM: number };
  return elevationM;
}

export async function fetchViewshed(
  lat: number,
  lon: number,
  radiusKm: number,
  altitudeM: number,
): Promise<GeoJSON.Feature<GeoJSON.Polygon>> {
  const response = await fetch(
    `/api/coverage/viewshed?lat=${lat}&lon=${lon}&radiusKm=${radiusKm}&altitudeM=${altitudeM}`,
  );
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return (await response.json()) as GeoJSON.Feature<GeoJSON.Polygon>;
}

export async function deleteViewshed(lat: number, lon: number, radiusKm: number): Promise<void> {
  await fetch(`/api/coverage/viewshed?lat=${lat}&lon=${lon}&radiusKm=${radiusKm}`, {
    method: "DELETE",
  });
}
