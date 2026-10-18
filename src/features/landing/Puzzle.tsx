import { useState } from "react";
import { Icon, type IconName } from "../../components/ui/Icon";
import { piecePath } from "./jigsaw";
import styles from "./Puzzle.module.css";

const SIZE = 150;

type Piece = {
  name: string;
  reading: string;
  icon: IconName;
  fill: string;
  stroke: string;
  /** Where the piece starts before it snaps into place. */
  tx: number;
  ty: number;
  r: number;
  delay: number;
};

// Pastel Notion-tag fills, with a stronger stroke for the line icon. Values are
// from the approved landing mockup.
const pieces: Piece[] = [
  {
    name: "Extreme heat",
    reading: "112°F by noon",
    icon: "heat",
    fill: "#ffe2dd",
    stroke: "#d44c47",
    tx: -120,
    ty: -60,
    r: -14,
    delay: 0.25,
  },
  {
    name: "Lightning",
    reading: "Strike 6 mi west",
    icon: "bolt",
    fill: "#fdecc8",
    stroke: "#cb9b00",
    tx: 60,
    ty: -110,
    r: 10,
    delay: 0.47,
  },
  {
    name: "Flooding",
    reading: "2.1 in overnight",
    icon: "flood",
    fill: "#d3e5ef",
    stroke: "#337ea9",
    tx: 170,
    ty: -40,
    r: 16,
    delay: 0.69,
  },
  {
    name: "Soil",
    reading: "94% saturated",
    icon: "soil",
    fill: "#eee0da",
    stroke: "#9f6b53",
    tx: -150,
    ty: 80,
    r: 12,
    delay: 0.91,
  },
  {
    name: "Wildfire",
    reading: "Low risk today",
    icon: "fire",
    fill: "#fadec9",
    stroke: "#d9730d",
    tx: 40,
    ty: 130,
    r: -12,
    delay: 1.13,
  },
  {
    name: "Wildlife",
    reading: "Gator 0.3 mi away",
    icon: "paw",
    fill: "#dbeddb",
    stroke: "#448361",
    tx: 180,
    ty: 90,
    r: -18,
    delay: 1.35,
  },
];

/** Six hazard pieces fly in, snap into a 3x2 picture, then the site's hazard index pops in. */
export function Puzzle() {
  // Changing the key remounts the pieces, which replays every animation.
  const [run, setRun] = useState(0);
  return (
    <div className={styles.puzzle}>
      <svg
        key={run}
        className={styles.board}
        viewBox="-20 -40 490 380"
        role="group"
        aria-label="Six hazard readings for one site"
      >
        {pieces.map((piece, index) => {
          const row = Math.floor(index / 3);
          const col = index % 3;
          const cx = col * SIZE + SIZE / 2;
          const top = row * SIZE;
          return (
            <g
              key={piece.name}
              className={styles.piece}
              role="img"
              aria-label={`${piece.name}, ${piece.reading}`}
              style={
                {
                  "--tx": `${piece.tx}px`,
                  "--ty": `${piece.ty}px`,
                  "--r": `${piece.r}deg`,
                  "--d": `${piece.delay}s`,
                } as React.CSSProperties
              }
            >
              <path
                d={piecePath(row, col, SIZE)}
                fill={piece.fill}
                stroke="#fff"
                strokeWidth="3"
                strokeLinejoin="round"
              />
              <Icon
                name={piece.icon}
                x={cx - 14}
                y={top + 35}
                width={28}
                height={28}
                style={{ color: piece.stroke }}
              />
              <text
                x={cx}
                y={top + 87}
                textAnchor="middle"
                className={styles.name}
              >
                {piece.name}
              </text>
              <text
                x={cx}
                y={top + 105}
                textAnchor="middle"
                className={styles.reading}
              >
                {piece.reading}
              </text>
            </g>
          );
        })}
      </svg>
      <div key={`score-${run}`} className={styles.score}>
        <small>
          Big Cypress Sub
          <br />
          Hazard index
        </small>
        <b>8.6</b>
        <span className={styles.stop}>Stop work</span>
      </div>
      <button
        type="button"
        className={styles.replay}
        onClick={() => setRun((n) => n + 1)}
      >
        ↻ replay
      </button>
    </div>
  );
}
