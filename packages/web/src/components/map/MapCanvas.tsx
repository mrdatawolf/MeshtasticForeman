import MapGL, { Layer, NavigationControl, Source, type MapRef } from "react-map-gl/maplibre";

import type React from "react";
import type { ReactNode, RefObject } from "react";

interface MapCanvasProps {
  mapRef: RefObject<MapRef | null>;
  hasGpsNodes: boolean;
  initialView: { longitude: number; latitude: number; zoom: number };
  mapStyle: string;
  planningMode: boolean;
  onMapClick: (
    event: Parameters<NonNullable<React.ComponentProps<typeof MapGL>["onClick"]>>[0],
  ) => void;
  coverageGeoJson: GeoJSON.FeatureCollection;
  proposalCoverageGeoJson: GeoJSON.FeatureCollection;
  solidGeoJson: GeoJSON.FeatureCollection;
  dashedGeoJson: GeoJSON.FeatureCollection;
  children: ReactNode;
}

export function MapCanvas({
  mapRef,
  hasGpsNodes,
  initialView,
  mapStyle,
  planningMode,
  onMapClick,
  coverageGeoJson,
  proposalCoverageGeoJson,
  solidGeoJson,
  dashedGeoJson,
  children,
}: MapCanvasProps) {
  return (
    <MapGL
      ref={mapRef}
      key={hasGpsNodes ? "has-gps" : "no-gps"}
      initialViewState={initialView}
      style={{ width: "100%", height: "100%" }}
      mapStyle={mapStyle}
      attributionControl={false}
      cursor={planningMode ? "crosshair" : "grab"}
      onClick={onMapClick}
    >
      <NavigationControl position="top-right" />
      <Source id="coverage" type="geojson" data={coverageGeoJson}>
        <Layer
          id="coverage-fill"
          type="fill"
          paint={{
            "fill-color": ["get", "color"],
            "fill-opacity": ["case", ["==", ["get", "focused"], 1], 0.28, 0.15],
          }}
        />
        <Layer
          id="coverage-outline"
          type="line"
          paint={{
            "line-color": ["get", "color"],
            "line-width": ["case", ["==", ["get", "focused"], 1], 2.5, 1.5],
            "line-opacity": ["case", ["==", ["get", "focused"], 1], 0.9, 0.65],
          }}
        />
      </Source>
      <Source id="proposal-coverage" type="geojson" data={proposalCoverageGeoJson}>
        <Layer
          id="proposal-coverage-fill"
          type="fill"
          paint={{ "fill-color": "#f59e0b", "fill-opacity": 0.18 }}
        />
        <Layer
          id="proposal-coverage-outline"
          type="line"
          paint={{
            "line-color": "#f59e0b",
            "line-width": 1.5,
            "line-dasharray": [3, 2],
            "line-opacity": 0.8,
          }}
        />
      </Source>
      <Source id="traceroutes-solid" type="geojson" data={solidGeoJson}>
        <Layer
          id="traceroutes-solid-line"
          type="line"
          paint={{ "line-color": ["get", "color"], "line-width": 2, "line-opacity": 0.75 }}
        />
      </Source>
      <Source id="traceroutes-dashed" type="geojson" data={dashedGeoJson}>
        <Layer
          id="traceroutes-dashed-line"
          type="line"
          paint={{
            "line-color": ["get", "color"],
            "line-width": 2,
            "line-opacity": 0.5,
            "line-dasharray": [3, 3],
          }}
        />
      </Source>
      {children}
    </MapGL>
  );
}
