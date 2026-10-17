import type { MapLibreMap } from "maplibre-gl";
import { sampleField } from "./field";
import type { ForecastGrid } from "./forecast";
import { colorAt, windRamp } from "./ramps";

/** Screen pixels a particle moves per frame, per m/s of wind. */
const PIXELS_PER_MS = 0.2;
const FADE = 0.09;
const COLOR_BUCKETS = 8;
const MAX_SPEED = 26;

type Particle = { x: number; y: number; age: number; life: number };

/**
 * Animated wind streaks drawn on a canvas over the map (under markers). The
 * wind is read from the forecast grid at each particle's location, so streaks
 * follow the real field as you pan and zoom. With reduced motion it draws a
 * still grid of arrows instead.
 */
export class WindParticles {
  private readonly canvas = document.createElement("canvas");
  private readonly context: CanvasRenderingContext2D;
  private grid?: ForecastGrid;
  private hour = 0;
  private particles: Particle[] = [];
  private frame = 0;
  private width = 0;
  private height = 0;
  private readonly colors: string[];

  constructor(
    private readonly map: MapLibreMap,
    private readonly reducedMotion: boolean,
  ) {
    this.context = this.canvas.getContext("2d")!;
    Object.assign(this.canvas.style, {
      position: "absolute",
      inset: "0",
      width: "100%",
      height: "100%",
      pointerEvents: "none",
    });
    this.canvas.setAttribute("aria-hidden", "true");
    // Straight after the map's own canvas, so markers and popups stay above.
    map
      .getCanvasContainer()
      .insertBefore(this.canvas, map.getCanvas().nextSibling);
    this.colors = Array.from({ length: COLOR_BUCKETS }, (_, b) => {
      const [r, g, bl, a] = colorAt(
        windRamp,
        (b / (COLOR_BUCKETS - 1)) * MAX_SPEED,
      );
      return `rgba(${Math.round(r)},${Math.round(g)},${Math.round(bl)},${(a / 255).toFixed(2)})`;
    });
    map.on("resize", this.onResize);
    map.on("movestart", this.onMoveStart);
    map.on("moveend", this.onMoveEnd);
    this.onResize();
    if (!reducedMotion) this.frame = requestAnimationFrame(this.tick);
  }

  setField(grid: ForecastGrid, hour: number): void {
    this.grid = grid;
    this.hour = hour;
    if (this.reducedMotion) this.drawArrows();
  }

  destroy(): void {
    cancelAnimationFrame(this.frame);
    this.map.off("resize", this.onResize);
    this.map.off("movestart", this.onMoveStart);
    this.map.off("moveend", this.onMoveEnd);
    this.canvas.remove();
  }

  private wind(x: number, y: number): [number, number] | undefined {
    if (!this.grid) return undefined;
    const { lng, lat } = this.map.unproject([x, y]);
    const u = sampleField(this.grid, this.grid.windU, this.hour, lng, lat);
    if (Number.isNaN(u)) return undefined;
    const v = sampleField(this.grid, this.grid.windV, this.hour, lng, lat);
    return [u, v];
  }

  private readonly onResize = () => {
    const container = this.map.getContainer();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.width = container.clientWidth;
    this.height = container.clientHeight;
    this.canvas.width = Math.round(this.width * dpr);
    this.canvas.height = Math.round(this.height * dpr);
    this.context.setTransform(dpr, 0, 0, dpr, 0, 0);
    const count = Math.min(
      3000,
      Math.max(400, Math.round((this.width * this.height) / 450)),
    );
    this.particles = Array.from({ length: count }, () =>
      this.spawn({ x: 0, y: 0, age: 0, life: 0 }),
    );
    if (this.reducedMotion) this.drawArrows();
  };

  private readonly onMoveStart = () => {
    this.context.clearRect(0, 0, this.width, this.height); // streaks from the old view
  };

  private readonly onMoveEnd = () => {
    if (this.reducedMotion) this.drawArrows();
  };

  private spawn(particle: Particle): Particle {
    particle.x = Math.random() * this.width;
    particle.y = Math.random() * this.height;
    particle.life = 50 + Math.random() * 90;
    particle.age = Math.random() * particle.life; // desynchronise so they don't pulse together
    return particle;
  }

  private readonly tick = () => {
    this.frame = requestAnimationFrame(this.tick);
    if (document.hidden || !this.grid) return;
    const { context } = this;
    context.globalCompositeOperation = "destination-out";
    context.fillStyle = `rgba(0,0,0,${FADE})`;
    context.fillRect(0, 0, this.width, this.height);
    context.globalCompositeOperation = "source-over";

    const paths: Path2D[] = this.colors.map(() => new Path2D());
    for (const p of this.particles) {
      const wind = this.wind(p.x, p.y);
      p.age += 1;
      if (!wind || p.age > p.life) {
        this.spawn(p);
        continue;
      }
      const [u, v] = wind;
      const nextX = p.x + u * PIXELS_PER_MS;
      const nextY = p.y - v * PIXELS_PER_MS; // screen y grows downward
      const bucket = Math.min(
        COLOR_BUCKETS - 1,
        Math.floor((Math.hypot(u, v) / MAX_SPEED) * (COLOR_BUCKETS - 1) + 0.5),
      );
      paths[bucket].moveTo(p.x, p.y);
      paths[bucket].lineTo(nextX, nextY);
      p.x = nextX;
      p.y = nextY;
      if (p.x < 0 || p.x > this.width || p.y < 0 || p.y > this.height)
        this.spawn(p);
    }
    context.lineWidth = 1.7;
    context.lineCap = "round";
    paths.forEach((path, bucket) => {
      context.strokeStyle = this.colors[bucket];
      context.stroke(path);
    });
  };

  /** Still alternative: an arrow every ~52px, pointing downwind, longer when stronger. */
  private drawArrows(): void {
    const { context } = this;
    context.clearRect(0, 0, this.width, this.height);
    if (!this.grid) return;
    const step = 52;
    context.lineWidth = 1.8;
    context.lineCap = "round";
    for (let y = step / 2; y < this.height; y += step)
      for (let x = step / 2; x < this.width; x += step) {
        const wind = this.wind(x, y);
        if (!wind) continue;
        const [u, v] = wind;
        const speed = Math.hypot(u, v);
        if (speed < 0.3) continue;
        const length = Math.min(30, 8 + speed * 1.6);
        const angle = Math.atan2(-v, u);
        const tipX = x + Math.cos(angle) * (length / 2);
        const tipY = y + Math.sin(angle) * (length / 2);
        const tailX = x - Math.cos(angle) * (length / 2);
        const tailY = y - Math.sin(angle) * (length / 2);
        const [r, g, b] = colorAt(windRamp, speed);
        context.strokeStyle = `rgb(${Math.round(r)},${Math.round(g)},${Math.round(b)})`;
        context.beginPath();
        context.moveTo(tailX, tailY);
        context.lineTo(tipX, tipY);
        context.moveTo(tipX, tipY);
        context.lineTo(
          tipX - Math.cos(angle - 0.5) * 6,
          tipY - Math.sin(angle - 0.5) * 6,
        );
        context.moveTo(tipX, tipY);
        context.lineTo(
          tipX - Math.cos(angle + 0.5) * 6,
          tipY - Math.sin(angle + 0.5) * 6,
        );
        context.stroke();
      }
  }
}
