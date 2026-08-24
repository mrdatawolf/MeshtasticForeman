import { request } from "./client.js";

export interface ViewshedPolygon {
  type: "Feature";
  geometry: { type: "Polygon"; coordinates: number[][][] };
  properties: Record<string, unknown> | null;
}

export interface ViewshedQuery {
  lat: number;
  lon: number;
  radiusKm: number;
  altitudeM?: number;
}

export function getViewshed(
  query: ViewshedQuery,
  signal?: AbortSignal,
): Promise<ViewshedPolygon | undefined> {
  return request<ViewshedPolygon>("/api/coverage/viewshed", { query: { ...query }, signal });
}

export function deleteViewshed(
  query: Omit<ViewshedQuery, "altitudeM">,
  signal?: AbortSignal,
): Promise<void> {
  return request<void>("/api/coverage/viewshed", {
    method: "DELETE",
    query: { ...query },
    signal,
  });
}
