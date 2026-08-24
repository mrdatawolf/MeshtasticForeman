import { polygon } from "@turf/helpers";
import { describe, expect, it } from "vitest";

import {
  buildCoverageCircle,
  clipViewshedToRadius,
  destinationPoint,
} from "./coordinateHelpers.js";

describe("coordinate helpers", () => {
  it("normalizes a destination that crosses the antimeridian", () => {
    const result = destinationPoint(0, 179.9, 90, 30);
    expect(result.lat).toBeCloseTo(0, 8);
    expect(result.lon).toBeCloseTo(-179.8302, 4);
  });

  it("reaches the north pole from the equator at a quarter circumference", () => {
    const result = destinationPoint(0, 0, 0, (Math.PI * 6371) / 2);
    expect(result.lat).toBeCloseTo(90, 8);
  });

  it("clips only viewshed vertices beyond the requested radius", () => {
    const input = polygon([
      [
        [0, 0],
        [0.01, 0],
        [1, 0],
        [0, 0],
      ],
    ]);
    const result = clipViewshedToRadius(input, 0, 0, 10);
    expect(result.geometry.coordinates[0][1]).toEqual([0.01, 0]);
    expect(result.geometry.coordinates[0][2][0]).toBeCloseTo(0.08993, 4);
  });

  it("builds a closed circle with the original kilometer conversions", () => {
    const result = buildCoverageCircle(10, 0, 1, "blue", 4, true);
    const ring = result.geometry.coordinates[0];
    expect(ring).toHaveLength(5);
    expect(ring[4][0]).toBeCloseTo(ring[0][0], 12);
    expect(ring[4][1]).toBeCloseTo(ring[0][1], 12);
    expect(ring[0][0]).toBeCloseTo(10 + 1 / 111.32, 12);
    expect(result.properties).toEqual({ color: "blue", focused: 1 });
  });
});
