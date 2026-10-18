/*
 * Jigsaw piece outlines for the landing puzzle: a 3 columns by 2 rows grid.
 * Neighbouring pieces share one curve (one bulges out where the other
 * indents), and the outer border stays flat.
 */

/** Which way the knob on a shared edge points: +1 bulges out of the piece, -1 indents. */
const rightSign = [
  [1, -1],
  [-1, 1],
]; // [row][col] for the edge between col and col + 1
const bottomSign = [-1, 1, -1]; // [col], for the edge between row 0 and row 1

const COLS = 3;
const ROWS = 2;
const KNOB_HEIGHT = 0.2;

type Point = [number, number];
const f = (n: number) => n.toFixed(1);
const pt = ([x, y]: Point) => `${f(x)},${f(y)}`;

/** One edge from `from` to `to`; `normal` points out of the piece, `sign` is 0 for a flat edge. */
function edge(
  from: Point,
  to: Point,
  normal: Point,
  sign: number,
  size: number,
) {
  const end = pt(to);
  if (sign === 0) return `L${end}`;
  const at = (t: number, out: number): Point => [
    from[0] +
      (to[0] - from[0]) * t +
      normal[0] * sign * KNOB_HEIGHT * size * out,
    from[1] +
      (to[1] - from[1]) * t +
      normal[1] * sign * KNOB_HEIGHT * size * out,
  ];
  return [
    `L${pt(at(0.36, 0))}`,
    `C${pt(at(0.4, 0))} ${pt(at(0.28, 1))} ${pt(at(0.5, 1))}`,
    `C${pt(at(0.72, 1))} ${pt(at(0.6, 0))} ${pt(at(0.64, 0))}`,
    `L${end}`,
  ].join(" ");
}

/** SVG path for the piece at (row, col) of the grid; each cell is `size` square and sits at its grid position. */
export function piecePath(row: number, col: number, size: number): string {
  const x0 = col * size;
  const y0 = row * size;
  const x1 = x0 + size;
  const y1 = y0 + size;
  const top = row > 0 ? -bottomSign[col] : 0;
  const right = col < COLS - 1 ? rightSign[row][col] : 0;
  const bottom = row < ROWS - 1 ? bottomSign[col] : 0;
  const left = col > 0 ? -rightSign[row][col - 1] : 0;
  return [
    `M${x0},${y0}`,
    edge([x0, y0], [x1, y0], [0, -1], top, size),
    edge([x1, y0], [x1, y1], [1, 0], right, size),
    edge([x1, y1], [x0, y1], [0, 1], bottom, size),
    edge([x0, y1], [x0, y0], [-1, 0], left, size),
    "Z",
  ].join(" ");
}
