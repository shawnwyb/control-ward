import { Icon } from "../../components/ui/Icon";
import { MiniMap } from "./MiniMap";
import styles from "./shots.module.css";

/*
 * Static recreations of the app's screens, drawn for the feature carousel.
 * They are decorative: the carousel marks each picture as an image with a
 * short label, so nothing inside is exposed to assistive technology.
 */

export function RiskBreakdownShot() {
  return (
    <div style={{ display: "flex", height: "100%" }}>
      <div style={{ flex: "1", padding: "16px 18px" }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <b
            style={{
              fontSize: "15px",
              display: "flex",
              gap: "7px",
              alignItems: "center",
            }}
          >
            <Icon
              name="tower"
              size={16}
              style={{ flex: "none", verticalAlign: -3 }}
            />{" "}
            Big Cypress Sub
          </b>
          <span
            className={`${styles.tag} ${styles.red}`}
            style={{ fontSize: "14px", padding: "2px 8px" }}
          >
            8.6
          </span>
        </div>
        <div
          style={{
            fontSize: "11px",
            color: "var(--ink-3)",
            margin: "2px 0 8px",
          }}
        >
          Combined hazard index · updated 2 min ago
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            fontSize: "12px",
            margin: "6px 0",
          }}
        >
          <Icon
            name="heat"
            size={14}
            style={{ flex: "none", verticalAlign: -3 }}
          />
          <span style={{ width: "70px" }}>Heat</span>
          <span
            style={{
              flex: "1",
              height: "7px",
              borderRadius: "4px",
              background: "var(--fill)",
              overflow: "hidden",
            }}
          >
            <i
              style={{
                display: "block",
                height: "100%",
                width: "91.0%",
                background: "#e16f64",
                borderRadius: "4px",
              }}
            ></i>
          </span>
          <span
            style={{ width: "24px", textAlign: "right", color: "var(--ink-2)" }}
          >
            9.1
          </span>
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            fontSize: "12px",
            margin: "6px 0",
          }}
        >
          <Icon
            name="bolt"
            size={14}
            style={{ flex: "none", verticalAlign: -3 }}
          />
          <span style={{ width: "70px" }}>Lightning</span>
          <span
            style={{
              flex: "1",
              height: "7px",
              borderRadius: "4px",
              background: "var(--fill)",
              overflow: "hidden",
            }}
          >
            <i
              style={{
                display: "block",
                height: "100%",
                width: "84.0%",
                background: "#d9a400",
                borderRadius: "4px",
              }}
            ></i>
          </span>
          <span
            style={{ width: "24px", textAlign: "right", color: "var(--ink-2)" }}
          >
            8.4
          </span>
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            fontSize: "12px",
            margin: "6px 0",
          }}
        >
          <Icon
            name="flood"
            size={14}
            style={{ flex: "none", verticalAlign: -3 }}
          />
          <span style={{ width: "70px" }}>Flooding</span>
          <span
            style={{
              flex: "1",
              height: "7px",
              borderRadius: "4px",
              background: "var(--fill)",
              overflow: "hidden",
            }}
          >
            <i
              style={{
                display: "block",
                height: "100%",
                width: "62.0%",
                background: "#5b97bd",
                borderRadius: "4px",
              }}
            ></i>
          </span>
          <span
            style={{ width: "24px", textAlign: "right", color: "var(--ink-2)" }}
          >
            6.2
          </span>
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            fontSize: "12px",
            margin: "6px 0",
          }}
        >
          <Icon
            name="soil"
            size={14}
            style={{ flex: "none", verticalAlign: -3 }}
          />
          <span style={{ width: "70px" }}>Soil</span>
          <span
            style={{
              flex: "1",
              height: "7px",
              borderRadius: "4px",
              background: "var(--fill)",
              overflow: "hidden",
            }}
          >
            <i
              style={{
                display: "block",
                height: "100%",
                width: "70.0%",
                background: "#b08a78",
                borderRadius: "4px",
              }}
            ></i>
          </span>
          <span
            style={{ width: "24px", textAlign: "right", color: "var(--ink-2)" }}
          >
            7.0
          </span>
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            fontSize: "12px",
            margin: "6px 0",
          }}
        >
          <Icon
            name="fire"
            size={14}
            style={{ flex: "none", verticalAlign: -3 }}
          />
          <span style={{ width: "70px" }}>Wildfire</span>
          <span
            style={{
              flex: "1",
              height: "7px",
              borderRadius: "4px",
              background: "var(--fill)",
              overflow: "hidden",
            }}
          >
            <i
              style={{
                display: "block",
                height: "100%",
                width: "14.0%",
                background: "#e38b4e",
                borderRadius: "4px",
              }}
            ></i>
          </span>
          <span
            style={{ width: "24px", textAlign: "right", color: "var(--ink-2)" }}
          >
            1.4
          </span>
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            fontSize: "12px",
            margin: "6px 0",
          }}
        >
          <Icon
            name="paw"
            size={14}
            style={{ flex: "none", verticalAlign: -3 }}
          />
          <span style={{ width: "70px" }}>Wildlife</span>
          <span
            style={{
              flex: "1",
              height: "7px",
              borderRadius: "4px",
              background: "var(--fill)",
              overflow: "hidden",
            }}
          >
            <i
              style={{
                display: "block",
                height: "100%",
                width: "40.0%",
                background: "#6aa583",
                borderRadius: "4px",
              }}
            ></i>
          </span>
          <span
            style={{ width: "24px", textAlign: "right", color: "var(--ink-2)" }}
          >
            4.0
          </span>
        </div>
      </div>
      <div style={{ width: "38%" }}>
        <MiniMap viewBox="90 140 140 160" />
      </div>
    </div>
  );
}

export function StopWorkShot() {
  return (
    <div style={{ position: "relative", height: "100%" }}>
      <MiniMap viewBox="40 120 220 160" />
      <div
        style={{
          position: "absolute",
          left: "16px",
          top: "16px",
          right: "16px",
          background: "#fff",
          borderRadius: "10px",
          boxShadow: "0 4px 16px rgba(15,15,15,.15)",
          padding: "12px 14px",
          display: "flex",
          gap: "12px",
          alignItems: "center",
        }}
      >
        <span
          style={{
            width: "36px",
            height: "36px",
            borderRadius: "8px",
            background: "#ffe2dd",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Icon
            name="bolt"
            size={20}
            style={{ flex: "none", verticalAlign: -3, color: "#d44c47" }}
          />
        </span>
        <span style={{ flex: "1" }}>
          <b>Stop work · lightning 6 mi west</b>
          <br />
          <small style={{ color: "var(--ink-2)" }}>
            Countdown restarts with every new strike within 10 mi
          </small>
        </span>
        <span
          style={{
            fontSize: "26px",
            fontWeight: "700",
            fontVariantNumeric: "tabular-nums",
            color: "#d44c47",
          }}
        >
          22:14
        </span>
      </div>
    </div>
  );
}

export function BriefingShot() {
  return (
    <div
      style={{ padding: "16px 22px", height: "100%", background: "#fbfbfa" }}
    >
      <div style={{ fontSize: "11px", color: "var(--ink-3)" }}>
        Today, 6:00 PM · to Big Cypress crew
      </div>
      <div
        style={{
          fontSize: "17px",
          fontWeight: "700",
          margin: "4px 0 10px",
          display: "flex",
          gap: "8px",
          alignItems: "center",
        }}
      >
        <Icon
          name="brief"
          size={18}
          style={{ flex: "none", verticalAlign: -3 }}
        />{" "}
        Tomorrow at Big Cypress Sub
      </div>
      <div
        style={{
          background: "#fff",
          borderRadius: "10px",
          boxShadow: "0 0 0 1px rgba(55,53,47,.08)",
          padding: "4px 12px",
          fontSize: "12.5px",
        }}
      >
        <div
          style={{
            display: "flex",
            gap: "10px",
            alignItems: "center",
            padding: "7px 0",
            borderBottom: "1px solid rgba(55,53,47,.07)",
          }}
        >
          <Icon
            name="heat"
            size={15}
            style={{ flex: "none", verticalAlign: -3 }}
          />
          <span style={{ flex: "1" }}>Heat index 108°F from 11 AM</span>
          <span className={`${styles.tag} ${styles.red}`}>High</span>
        </div>
        <div
          style={{
            display: "flex",
            gap: "10px",
            alignItems: "center",
            padding: "7px 0",
            borderBottom: "1px solid rgba(55,53,47,.07)",
          }}
        >
          <Icon
            name="bolt"
            size={15}
            style={{ flex: "none", verticalAlign: -3 }}
          />
          <span style={{ flex: "1" }}>Storms likely after 2 PM</span>
          <span className={`${styles.tag} ${styles.org}`}>Moderate</span>
        </div>
        <div
          style={{
            display: "flex",
            gap: "10px",
            alignItems: "center",
            padding: "7px 0",
          }}
        >
          <Icon
            name="soil"
            size={15}
            style={{ flex: "none", verticalAlign: -3 }}
          />
          <span style={{ flex: "1" }}>Access road soft, use mats</span>
          <span className={`${styles.tag} ${styles.yel}`}>Low</span>
        </div>
      </div>
      <div
        style={{ fontSize: "12px", color: "var(--ink-2)", marginTop: "10px" }}
      >
        Plan: start 6 AM, heavy work done by 1 PM.
      </div>
    </div>
  );
}

export function ReportDrawerShot() {
  return (
    <div style={{ position: "relative", height: "100%" }}>
      <MiniMap viewBox="150 120 260 180" />
      <div
        style={{
          position: "absolute",
          top: "12px",
          right: "12px",
          bottom: "12px",
          width: "46%",
          background: "#fff",
          borderRadius: "10px",
          boxShadow: "0 4px 16px rgba(15,15,15,.18)",
          padding: "12px",
        }}
      >
        <b>Report a hazard</b>
        <div
          style={{
            fontSize: "11px",
            color: "var(--ink-2)",
            margin: "2px 0 8px",
          }}
        >
          Pinned at your location · ±15 ft
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(3,1fr)",
            gap: "5px",
            fontSize: "10.5px",
            textAlign: "center",
          }}
        >
          <span
            style={{
              border: "1px solid rgba(55,53,47,.12)",
              borderRadius: "7px",
              padding: "6px 2px",
            }}
          >
            <Icon
              name="soil"
              size={14}
              style={{ flex: "none", verticalAlign: -3 }}
            />
            <br />
            Debris
          </span>
          <span
            style={{
              border: "1.5px solid var(--ink)",
              borderRadius: "7px",
              padding: "6px 2px",
              background: "var(--sidebar)",
            }}
          >
            <Icon
              name="paw"
              size={14}
              style={{ flex: "none", verticalAlign: -3 }}
            />
            <br />
            Wildlife
          </span>
          <span
            style={{
              border: "1px solid rgba(55,53,47,.12)",
              borderRadius: "7px",
              padding: "6px 2px",
            }}
          >
            <Icon
              name="bolt"
              size={14}
              style={{ flex: "none", verticalAlign: -3 }}
            />
            <br />
            Line down
          </span>
        </div>
        <div
          style={{
            border: "1.5px dashed rgba(55,53,47,.2)",
            borderRadius: "7px",
            padding: "7px",
            margin: "8px 0",
            fontSize: "11px",
            color: "var(--ink-2)",
            display: "flex",
            gap: "6px",
            alignItems: "center",
          }}
        >
          <Icon
            name="camera"
            size={14}
            style={{ flex: "none", verticalAlign: -3 }}
          />{" "}
          Add photo (optional)
        </div>
        <div
          style={{
            background: "var(--ink)",
            color: "#fff",
            borderRadius: "7px",
            padding: "7px",
            textAlign: "center",
            fontSize: "12px",
            fontWeight: "600",
          }}
        >
          Send report
        </div>
      </div>
      <div style={{ position: "absolute", left: "24%", top: "38%" }}>
        <svg width="26" height="34" viewBox="0 0 34 44">
          <path
            d="M17 43C17 43 33 27 33 16A16 16 0 0 0 1 16C1 27 17 43 17 43Z"
            fill="#37352f"
          />
          <g
            transform="translate(7 6) scale(.83)"
            fill="none"
            stroke="#fff"
            strokeWidth="1.9"
            strokeLinecap="round"
          >
            <circle cx="5.5" cy="11" r="1.6" />
            <circle cx="9.5" cy="6.5" r="1.6" />
            <circle cx="14.5" cy="6.5" r="1.6" />
            <circle cx="18.5" cy="11" r="1.6" />
            <path d="M12 12c3 0 5.5 3 5.5 5.5 0 2-1.5 2.5-3 2-1-.4-1.6-.6-2.5-.6s-1.5.2-2.5.6c-1.5.5-3 0-3-2C6.5 15 9 12 12 12z" />
          </g>
        </svg>
      </div>
    </div>
  );
}

export function SitesMapShot() {
  return (
    <div style={{ display: "flex", height: "100%" }}>
      <div
        style={{
          width: "42%",
          padding: "12px 14px",
          fontSize: "12px",
          borderRight: "1px solid rgba(55,53,47,.08)",
        }}
      >
        <b style={{ fontSize: "14px" }}>Sites by risk</b>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            padding: "6px 0",
            borderBottom: "1px solid rgba(55,53,47,.07)",
          }}
        >
          <span style={{ display: "flex", gap: "6px", alignItems: "center" }}>
            <Icon
              name="bolt"
              size={13}
              style={{ flex: "none", verticalAlign: -3 }}
            />
            Big Cypress Sub
          </span>
          <span className={`${styles.tag} ${styles.red}`}>8.6</span>
        </div>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            padding: "6px 0",
            borderBottom: "1px solid rgba(55,53,47,.07)",
          }}
        >
          <span style={{ display: "flex", gap: "6px", alignItems: "center" }}>
            <Icon
              name="flood"
              size={13}
              style={{ flex: "none", verticalAlign: -3 }}
            />
            Hollis River Line
          </span>
          <span className={`${styles.tag} ${styles.org}`}>6.9</span>
        </div>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            padding: "6px 0",
            borderBottom: "1px solid rgba(55,53,47,.07)",
          }}
        >
          <span style={{ display: "flex", gap: "6px", alignItems: "center" }}>
            <Icon
              name="heat"
              size={13}
              style={{ flex: "none", verticalAlign: -3 }}
            />
            Tamiami Yard
          </span>
          <span className={`${styles.tag} ${styles.org}`}>6.2</span>
        </div>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            padding: "6px 0",
            borderBottom: "1px solid rgba(55,53,47,.07)",
          }}
        >
          <span style={{ display: "flex", gap: "6px", alignItems: "center" }}>
            <Icon
              name="wind"
              size={13}
              style={{ flex: "none", verticalAlign: -3 }}
            />
            Coastal Tie-in
          </span>
          <span className={`${styles.tag} ${styles.yel}`}>4.1</span>
        </div>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            padding: "6px 0",
            borderBottom: "1px solid rgba(55,53,47,.07)",
          }}
        >
          <span style={{ display: "flex", gap: "6px", alignItems: "center" }}>
            <Icon
              name="paw"
              size={13}
              style={{ flex: "none", verticalAlign: -3 }}
            />
            North Lake Sub
          </span>
          <span className={`${styles.tag} ${styles.grn}`}>2.3</span>
        </div>
      </div>
      <div style={{ flex: "1" }}>
        <MiniMap viewBox="60 40 420 320" />
      </div>
    </div>
  );
}

export function ForecastShot() {
  return (
    <div
      style={{
        padding: "16px 20px",
        height: "100%",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <b style={{ display: "flex", gap: "7px", alignItems: "center" }}>
          <Icon
            name="heat"
            size={15}
            style={{ flex: "none", verticalAlign: -3 }}
          />{" "}
          7-day hazard forecast
        </b>
        <span style={{ fontSize: "11px", color: "var(--ink-3)" }}>
          ML model · NOAA + OSHA history
        </span>
      </div>
      <div
        style={{
          flex: "1",
          display: "flex",
          gap: "8px",
          alignItems: "flex-end",
          paddingTop: "12px",
        }}
      >
        <div
          style={{
            flex: "1",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: "4px",
            justifyContent: "flex-end",
            height: "100%",
          }}
        >
          <span style={{ fontSize: "11px", color: "var(--ink-2)" }}>8.6</span>
          <i
            style={{
              display: "block",
              width: "70%",
              height: "86.0%",
              background: "#e16f64",
              borderRadius: "5px 5px 2px 2px",
            }}
          ></i>
          <span style={{ fontSize: "11px", color: "var(--ink-3)" }}>Today</span>
        </div>
        <div
          style={{
            flex: "1",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: "4px",
            justifyContent: "flex-end",
            height: "100%",
          }}
        >
          <span style={{ fontSize: "11px", color: "var(--ink-2)" }}>7.2</span>
          <i
            style={{
              display: "block",
              width: "70%",
              height: "72.0%",
              background: "#e16f64",
              borderRadius: "5px 5px 2px 2px",
            }}
          ></i>
          <span style={{ fontSize: "11px", color: "var(--ink-3)" }}>Sat</span>
        </div>
        <div
          style={{
            flex: "1",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: "4px",
            justifyContent: "flex-end",
            height: "100%",
          }}
        >
          <span style={{ fontSize: "11px", color: "var(--ink-2)" }}>5.1</span>
          <i
            style={{
              display: "block",
              width: "70%",
              height: "51.0%",
              background: "#e38b4e",
              borderRadius: "5px 5px 2px 2px",
            }}
          ></i>
          <span style={{ fontSize: "11px", color: "var(--ink-3)" }}>Sun</span>
        </div>
        <div
          style={{
            flex: "1",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: "4px",
            justifyContent: "flex-end",
            height: "100%",
          }}
        >
          <span style={{ fontSize: "11px", color: "var(--ink-2)" }}>3.4</span>
          <i
            style={{
              display: "block",
              width: "70%",
              height: "34.0%",
              background: "#6aa583",
              borderRadius: "5px 5px 2px 2px",
            }}
          ></i>
          <span style={{ fontSize: "11px", color: "var(--ink-3)" }}>Mon</span>
        </div>
        <div
          style={{
            flex: "1",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: "4px",
            justifyContent: "flex-end",
            height: "100%",
          }}
        >
          <span style={{ fontSize: "11px", color: "var(--ink-2)" }}>4.8</span>
          <i
            style={{
              display: "block",
              width: "70%",
              height: "48.0%",
              background: "#d9a400",
              borderRadius: "5px 5px 2px 2px",
            }}
          ></i>
          <span style={{ fontSize: "11px", color: "var(--ink-3)" }}>Tue</span>
        </div>
        <div
          style={{
            flex: "1",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: "4px",
            justifyContent: "flex-end",
            height: "100%",
          }}
        >
          <span style={{ fontSize: "11px", color: "var(--ink-2)" }}>6.6</span>
          <i
            style={{
              display: "block",
              width: "70%",
              height: "66.0%",
              background: "#e38b4e",
              borderRadius: "5px 5px 2px 2px",
            }}
          ></i>
          <span style={{ fontSize: "11px", color: "var(--ink-3)" }}>Wed</span>
        </div>
        <div
          style={{
            flex: "1",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: "4px",
            justifyContent: "flex-end",
            height: "100%",
          }}
        >
          <span style={{ fontSize: "11px", color: "var(--ink-2)" }}>3.0</span>
          <i
            style={{
              display: "block",
              width: "70%",
              height: "30.0%",
              background: "#6aa583",
              borderRadius: "5px 5px 2px 2px",
            }}
          ></i>
          <span style={{ fontSize: "11px", color: "var(--ink-3)" }}>Thu</span>
        </div>
      </div>
    </div>
  );
}
