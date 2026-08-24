import { polygon } from "@turf/helpers";
import { describe, expect, it } from "vitest";

import { mergeCoveragePolygons } from "./coverageMath.js";

function planarArea(feature: GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>): number {
  const polygons =
    feature.geometry.type === "Polygon"
      ? [feature.geometry.coordinates]
      : feature.geometry.coordinates;
  return polygons.reduce((total, rings) => {
    const ringArea = rings.reduce((polygonArea, ring, ringIndex) => {
      let signed = 0;
      for (let index = 0; index < ring.length - 1; index++) {
        signed += ring[index][0] * ring[index + 1][1] - ring[index + 1][0] * ring[index][1];
      }
      const area = Math.abs(signed) / 2;
      return polygonArea + (ringIndex === 0 ? area : -area);
    }, 0);
    return total + ringArea;
  }, 0);
}

describe("mergeCoveragePolygons", () => {
  it("produces the known union area for two half-overlapping unit squares", () => {
    const left = polygon([[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]]);
    const right = polygon([[[0.5, 0], [1.5, 0], [1.5, 1], [0.5, 1], [0.5, 0]]]);

    const result = mergeCoveragePolygons([left, right], "#3b82f6", false);

    expect(result.features).toHaveLength(1);
    expect(planarArea(result.features[0] as GeoJSON.Feature<GeoJSON.Polygon>)).toBeCloseTo(1.5, 12);
    expect(result.features[0].properties).toEqual({ color: "#3b82f6", focused: 0 });
  });

  it("styles a single polygon without changing its geometry", () => {
    const square = polygon([[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]]);
    const result = mergeCoveragePolygons([square], "red", true);
    expect(result.features[0].geometry).toEqual(square.geometry);
    expect(result.features[0].properties).toEqual({ color: "red", focused: 1 });
  });

  it("returns an empty collection for no coverage", () => {
    expect(mergeCoveragePolygons([], "blue", false).features).toEqual([]);
  });
});
