import { featureCollection } from "@turf/helpers";
import { union } from "@turf/union";

export function mergeCoveragePolygons(
  features: GeoJSON.Feature[],
  color: string,
  focused: boolean,
): GeoJSON.FeatureCollection {
  if (features.length === 0) return featureCollection([]);
  if (features.length === 1) {
    return featureCollection([{ ...features[0], properties: { color, focused: focused ? 1 : 0 } }]);
  }

  try {
    const unioned = union(
      featureCollection(features as GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>[]),
    );
    if (unioned) {
      unioned.properties = { color, focused: focused ? 1 : 0 };
      return featureCollection([unioned]);
    }
  } catch {
    // Invalid geometry retains the page's previous individual-polygon fallback.
  }
  return featureCollection(features);
}
