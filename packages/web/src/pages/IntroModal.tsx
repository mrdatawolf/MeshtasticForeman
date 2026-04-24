export function IntroModal({ onClose, onSetupWizard }: {
  onClose: () => void;
  onSetupWizard: () => void;
}) {
  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.modal} onClick={e => e.stopPropagation()}>

        <div style={styles.header}>
          <span style={styles.headerLabel}>Welcome to Meshtastic Foreman</span>
          <button style={styles.closeBtn} onClick={onClose}>✕ skip</button>
        </div>

        <div style={styles.body}>
          <p style={styles.lead}>
            Foreman is a local dashboard for your Meshtastic mesh network. It connects to
            your device over USB, shows every node on the mesh, and gives you messaging,
            map, and telemetry views — all from your browser.
          </p>

          <div style={styles.section}>
            <div style={styles.sectionTitle}>Getting started</div>
            <div style={styles.stepList}>
              <Step n="1" title="Connect a device">
                Plug your Meshtastic device in via USB. Set <code style={styles.code}>MESHTASTIC_PORT</code> in
                your <code style={styles.code}>.env</code> file (e.g. <code style={styles.code}>COM7</code> or{" "}
                <code style={styles.code}>/dev/ttyUSB0</code>) and the daemon will connect on startup.
                You can also connect manually via <strong style={styles.strong}>API → Devices</strong>.
              </Step>
              <Step n="2" title="Run the Setup Wizard">
                The wizard walks you through picking your LoRa region, enabling MQTT, and
                turning on optional features like Neighbor Info and Store & Forward. It lives
                in <strong style={styles.strong}>Settings → Device Config</strong>.
              </Step>
              <Step n="3" title="Explore your mesh">
                Once connected, nodes appear automatically. Use the tabs at the top to switch
                between views.
              </Step>
            </div>
          </div>

          <div style={styles.section}>
            <div style={styles.sectionTitle}>The main views</div>
            <div style={styles.pageGrid}>
              <PageCard name="Nodes" desc="Every node heard by your device — signal, battery, last seen." />
              <PageCard name="Map" desc="Geographic view of your mesh and MQTT nodes with coverage circles." />
              <PageCard name="Messages" desc="Send and receive direct and broadcast messages." />
              <PageCard name="Analytics" desc="SNR trends, hop counts, packet statistics, and telemetry." />
            </div>
          </div>

          <div style={styles.section}>
            <div style={styles.sectionTitle}>Tips</div>
            <ul style={styles.tips}>
              <li>The <strong style={styles.strong}>API</strong> header button shows connection status and lets you disconnect / reconnect a device.</li>
              <li>The <strong style={styles.strong}>MQTT</strong> header button toggles the gateway and filters nodes by region.</li>
              <li>The <strong style={styles.strong}>GPS</strong> header button shows your device's GPS fix details and lets you refresh its position.</li>
              <li>Click <strong style={styles.strong}>?</strong> in the header any time to reopen this guide.</li>
            </ul>
          </div>
        </div>

        <div style={styles.footer}>
          <button style={styles.skipBtn} onClick={onClose}>Skip for now</button>
          <button style={styles.wizardBtn} onClick={onSetupWizard}>
            Set up my device →
          </button>
        </div>

      </div>
    </div>
  );
}

function Step({ n, title, children }: { n: string; title: string; children: React.ReactNode }) {
  return (
    <div style={stepStyles.row}>
      <span style={stepStyles.num}>{n}</span>
      <div>
        <div style={stepStyles.title}>{title}</div>
        <div style={stepStyles.body}>{children}</div>
      </div>
    </div>
  );
}

function PageCard({ name, desc }: { name: string; desc: string }) {
  return (
    <div style={cardStyles.card}>
      <div style={cardStyles.name}>{name}</div>
      <div style={cardStyles.desc}>{desc}</div>
    </div>
  );
}

const stepStyles: Record<string, React.CSSProperties> = {
  row: { display: "flex", gap: "0.75rem", alignItems: "flex-start" },
  num: {
    flexShrink: 0, width: "1.4rem", height: "1.4rem",
    borderRadius: "50%", background: "#1e3a5f", border: "1px solid #3b82f6",
    color: "#93c5fd", fontSize: "0.7rem", fontFamily: "monospace",
    display: "flex", alignItems: "center", justifyContent: "center",
    marginTop: "0.1rem",
  },
  title: { color: "#e2e8f0", fontSize: "0.85rem", fontWeight: "bold", marginBottom: "0.15rem" },
  body:  { color: "#94a3b8", fontSize: "0.8rem", lineHeight: 1.6 },
};

const cardStyles: Record<string, React.CSSProperties> = {
  card: {
    background: "#0d1420", border: "1px solid #1e293b", borderRadius: "0.375rem",
    padding: "0.65rem 0.85rem",
  },
  name: { color: "#60a5fa", fontSize: "0.82rem", fontWeight: "bold", marginBottom: "0.2rem", fontFamily: "monospace" },
  desc: { color: "#64748b", fontSize: "0.75rem", lineHeight: 1.5 },
};

const styles: Record<string, React.CSSProperties> = {
  overlay: {
    position: "fixed", inset: 0, zIndex: 300,
    background: "rgba(0,0,0,0.8)",
    display: "flex", alignItems: "center", justifyContent: "center",
  },
  modal: {
    background: "#0f172a", border: "1px solid #1e293b",
    borderRadius: "0.5rem", width: "90vw", maxWidth: "680px",
    maxHeight: "90vh", display: "flex", flexDirection: "column",
    boxShadow: "0 16px 48px rgba(0,0,0,0.8)",
  },
  header: {
    display: "flex", alignItems: "center", justifyContent: "space-between",
    padding: "0.75rem 1.25rem", borderBottom: "1px solid #1e293b", flexShrink: 0,
  },
  headerLabel: {
    color: "#f1f5f9", fontSize: "0.95rem", fontWeight: "bold", fontFamily: "monospace",
  },
  closeBtn: {
    background: "none", border: "1px solid #1e293b", color: "#64748b",
    cursor: "pointer", borderRadius: "0.25rem", padding: "0.15rem 0.5rem",
    fontFamily: "monospace", fontSize: "0.8rem",
  },
  body: {
    flex: 1, overflowY: "auto", padding: "1.25rem 1.5rem",
    display: "flex", flexDirection: "column", gap: "1.5rem",
  },
  lead: {
    color: "#94a3b8", fontSize: "0.85rem", lineHeight: 1.65, margin: 0,
  },
  section: { display: "flex", flexDirection: "column", gap: "0.6rem" },
  sectionTitle: {
    fontSize: "0.65rem", color: "#475569", textTransform: "uppercase",
    letterSpacing: "0.08em",
  },
  stepList: { display: "flex", flexDirection: "column", gap: "0.75rem" },
  pageGrid: {
    display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: "0.5rem",
  },
  tips: {
    color: "#64748b", fontSize: "0.8rem", lineHeight: 1.6,
    paddingLeft: "1.25rem", margin: 0, display: "flex", flexDirection: "column", gap: "0.3rem",
  },
  code: {
    background: "#1e293b", borderRadius: "0.2rem", padding: "0.05rem 0.3rem",
    fontSize: "0.78rem", color: "#7dd3fc", fontFamily: "monospace",
  },
  strong: { color: "#e2e8f0" },
  footer: {
    display: "flex", justifyContent: "flex-end", alignItems: "center", gap: "0.6rem",
    padding: "0.75rem 1.25rem", borderTop: "1px solid #1e293b", flexShrink: 0,
  },
  skipBtn: {
    background: "transparent", border: "1px solid #1e293b", color: "#64748b",
    padding: "0.35rem 1rem", borderRadius: "0.375rem", cursor: "pointer",
    fontFamily: "monospace", fontSize: "0.82rem",
  },
  wizardBtn: {
    background: "#1e3a5f", border: "1px solid #3b82f6", color: "#93c5fd",
    padding: "0.35rem 1.25rem", borderRadius: "0.375rem", cursor: "pointer",
    fontFamily: "monospace", fontSize: "0.82rem", fontWeight: "bold",
  },
};
