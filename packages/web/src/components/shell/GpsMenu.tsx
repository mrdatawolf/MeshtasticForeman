import { useRef, useState } from "react";

import { useClickOutside } from "../../hooks/useClickOutside.js";
import { foremanClient } from "../../ws/client.js";

import gpsStyles from "./GpsMenu.module.css";
import { menuBtnClass, styles } from "./shellStyles.js";

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
  return (
    <div ref={ref} className={gpsStyles.gpsContainer}>
      <button onClick={() => setOpen((value) => !value)} className={menuBtnClass(open, hasAnyGps)}>
        <span className={hasAnyGps ? gpsStyles.gpsDotOn : gpsStyles.gpsDotOff}>●</span>GPS
        <span className={styles.caret}>▾</span>
      </button>
      {open && (
        <div className={`${styles.menuPanel} ${gpsStyles.gpsPanel}`}>
          {connectedDevices.length === 0 ? (
            <div className={styles.menuSection}>
              <span className={styles.muted72}>No connected devices</span>
            </div>
          ) : (
            connectedDevices.map((device) => (
              <div key={device.id}>
                <div className={styles.menuSection}>
                  <span className={styles.menuSectionLabel}>{device.port}</span>
                  {device.gpsDetail ? (
                    <table className={gpsStyles.gpsTable}>
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
                            <td className={gpsStyles.gpsTableLabel}>{label}</td>
                            <td className={gpsStyles.gpsTableValue}>{String(value)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : (
                    <span className={gpsStyles.gpsWaiting}>Waiting for GPS fix…</span>
                  )}
                  {device.ownNodeId != null && (
                    <button
                      className={`${gpsStyles.gpsRefreshBtn} ${
                        pending.has(device.id) ? gpsStyles.gpsRefreshBtnPending : ""
                      }`}
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
                      {pending.has(device.id) && <span className={gpsStyles.gpsSpinner} />}
                      {pending.has(device.id) ? "Refreshing…" : "Refresh GPS"}
                    </button>
                  )}
                  {device.ownNodeId == null && (
                    <span className={gpsStyles.gpsNoNodeId}>
                      Node ID not yet known — reconnect to enable position request
                    </span>
                  )}
                </div>
                <div className={styles.menuDivider} />
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
