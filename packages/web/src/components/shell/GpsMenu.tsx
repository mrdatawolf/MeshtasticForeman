import { useRef, useState } from "react";

import { useClickOutside } from "../../hooks/useClickOutside.js";
import { foremanClient } from "../../ws/client.js";

import { menuBtnStyle, styles } from "./shellStyles.js";

import type { DeviceInfo } from "@foreman/shared";

interface Props {
  devices: DeviceInfo[];
  pending: Set<string>;
  setPending: React.Dispatch<React.SetStateAction<Set<string>>>;
}

export function GpsMenu({ devices, pending, setPending }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useClickOutside(ref, () => setOpen(false), open);
  const connectedDevices = devices.filter((device) => device.status === "connected");
  const hasAnyGps = connectedDevices.some((device) => device.hasGpsPosition);
  const gpsColor = hasAnyGps ? "#22c55e" : "#ef4444";
  return (
    <div ref={ref} style={{ position: "relative", flexShrink: 0, marginLeft: "auto" }}>
      <button onClick={() => setOpen((value) => !value)} style={menuBtnStyle(open, hasAnyGps)}>
        <span style={{ color: gpsColor, fontSize: "0.65rem" }}>●</span>GPS
        <span style={{ color: "#475569", marginLeft: "0.3rem", fontSize: "0.65rem" }}>▾</span>
      </button>
      {open && (
        <div style={{ ...styles.menuPanel, minWidth: "300px" }}>
          <style>{`@keyframes _spin { to { transform: rotate(360deg); } }`}</style>
          {connectedDevices.length === 0 ? (
            <div style={styles.menuSection}>
              <span style={{ color: "#475569", fontSize: "0.72rem" }}>No connected devices</span>
            </div>
          ) : (
            connectedDevices.map((device) => (
              <div key={device.id}>
                <div style={styles.menuSection}>
                  <span style={styles.menuSectionLabel}>{device.port}</span>
                  {device.gpsDetail ? (
                    <table
                      style={{ width: "100%", fontSize: "0.75rem", borderCollapse: "collapse" }}
                    >
                      <tbody>
                        {[
                          ["Latitude", device.gpsDetail.latitude.toFixed(6)],
                          ["Longitude", device.gpsDetail.longitude.toFixed(6)],
                          [
                            "Altitude",
                            device.gpsDetail.altitude != null
                              ? `${device.gpsDetail.altitude} m`
                              : "—",
                          ],
                          ["Sats in view", device.gpsDetail.satsInView ?? "—"],
                          [
                            "PDOP",
                            device.gpsDetail.pdop != null
                              ? (device.gpsDetail.pdop / 100).toFixed(2)
                              : "—",
                          ],
                          [
                            "HDOP",
                            device.gpsDetail.hdop != null
                              ? (device.gpsDetail.hdop / 100).toFixed(2)
                              : "— (enable HVDOP flag)",
                          ],
                          [
                            "Source",
                            device.gpsDetail.locationSource != null
                              ? (["Unset", "Manual", "Internal", "External"][
                                  device.gpsDetail.locationSource
                                ] ?? device.gpsDetail.locationSource)
                              : "—",
                          ],
                          [
                            "GPS time",
                            device.gpsDetail.gpsTimestamp
                              ? new Date(device.gpsDetail.gpsTimestamp).toLocaleTimeString()
                              : "—",
                          ],
                        ].map(([label, value]) => (
                          <tr key={String(label)}>
                            <td
                              style={{
                                color: "#475569",
                                paddingRight: "0.75rem",
                                paddingBottom: "0.15rem",
                              }}
                            >
                              {label}
                            </td>
                            <td style={{ color: "#e2e8f0", fontFamily: "monospace" }}>
                              {String(value)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : (
                    <span style={{ color: "#475569", fontSize: "0.75rem" }}>
                      Waiting for GPS fix…
                    </span>
                  )}
                  {device.ownNodeId != null && (
                    <button
                      style={{
                        background: "#1e293b",
                        border: "1px solid #334155",
                        color: "#94a3b8",
                        padding: "0.2rem 0.6rem",
                        borderRadius: "0.25rem",
                        cursor: pending.has(device.id) ? "default" : "pointer",
                        fontFamily: "monospace",
                        fontSize: "0.75rem",
                        marginTop: "0.5rem",
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "0.35rem",
                        opacity: pending.has(device.id) ? 0.7 : 1,
                      }}
                      disabled={pending.has(device.id)}
                      onClick={() => {
                        console.log(
                          `[gps] requesting position for device ${device.id} nodeId=${device.ownNodeId}`,
                        );
                        setPending((previous) => new Set(previous).add(device.id));
                        foremanClient.send({
                          type: "node:request-position",
                          payload: { deviceId: device.id, nodeId: device.ownNodeId! },
                        });
                        setTimeout(
                          () =>
                            setPending((previous) => {
                              const next = new Set(previous);
                              next.delete(device.id);
                              return next;
                            }),
                          15000,
                        );
                      }}
                    >
                      {pending.has(device.id) && (
                        <span
                          style={{
                            display: "inline-block",
                            width: "0.7rem",
                            height: "0.7rem",
                            border: "2px solid #475569",
                            borderTopColor: "#94a3b8",
                            borderRadius: "50%",
                            animation: "_spin 0.7s linear infinite",
                          }}
                        />
                      )}
                      {pending.has(device.id) ? "Refreshing…" : "Refresh GPS"}
                    </button>
                  )}
                  {device.ownNodeId == null && (
                    <span
                      style={{
                        color: "#475569",
                        fontSize: "0.7rem",
                        marginTop: "0.4rem",
                        display: "block",
                      }}
                    >
                      Node ID not yet known — reconnect to enable position request
                    </span>
                  )}
                </div>
                <div style={styles.menuDivider} />
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
