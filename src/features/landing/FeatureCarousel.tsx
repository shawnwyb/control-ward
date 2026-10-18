import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { Icon } from "../../components/ui/Icon";
import {
  BriefingShot,
  ForecastShot,
  ReportDrawerShot,
  RiskBreakdownShot,
  SitesMapShot,
  StopWorkShot,
} from "./shots";
import styles from "./FeatureCarousel.module.css";

const AUTO_ADVANCE_MS = 4500;

type Slide = {
  title: string;
  text: string;
  label: string;
  picture: ReactNode;
};

const slides: Slide[] = [
  {
    title: "One risk picture per site",
    text: "Weather, heat, lightning, flooding, wildfire, soil and wildlife rolled into one score for each of 50+ real power plant sites.",
    label:
      "Big Cypress Sub with a hazard index of 8.6 and a bar for each hazard",
    picture: <RiskBreakdownShot />,
  },
  {
    title: "Instant stop-work alerts",
    text: "A strike within 10 miles starts a 30-minute all-clear countdown that restarts with every new strike. Flood warnings follow a night of heavy rain.",
    label: "Map with a stop-work banner and a 22:14 lightning countdown",
    picture: <StopWorkShot />,
  },
  {
    title: "6 PM next-day briefing",
    text: "Every evening at 6 PM local time, each crew gets tomorrow's hazards for their site and a plan to work around them.",
    label: "Evening briefing listing tomorrow's heat, storm and soil hazards",
    picture: <BriefingShot />,
  },
  {
    title: "Crew hazard reports",
    text: "Like reporting a crash in Waze: pick the hazard, the pin drops where you stand, add a photo if you want. Shared with the team and saved for future projects.",
    label: "Report a hazard drawer over the map with a wildlife pin",
    picture: <ReportDrawerShot />,
  },
  {
    title: "Supervisor dashboard",
    text: "Sites ranked by risk next to a live map, so supervisors know where to send attention and resources first.",
    label: "Sites ranked by risk beside a map",
    picture: <SitesMapShot />,
  },
  {
    title: "Hazard index 0–10",
    text: "A machine learning model trained on historical weather and incident data scores today and forecasts the week ahead.",
    label: "Bar chart of the 7-day hazard forecast",
    picture: <ForecastShot />,
  },
];

function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Sliding feature tour: scroll-snap track, arrows, dots and a gentle auto-advance. */
export function FeatureCarousel() {
  const trackRef = useRef<HTMLUListElement>(null);
  const [current, setCurrent] = useState(0);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [touched, setTouched] = useState(false);
  const touchTimer = useRef<number>(0);
  const [reduced, setReduced] = useState(prefersReducedMotion);

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(query.matches);
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  const step = useCallback(() => {
    const track = trackRef.current;
    const [first, second] = [track?.children[0], track?.children[1]] as (
      HTMLElement | undefined
    )[];
    return first && second ? second.offsetLeft - first.offsetLeft : 0;
  }, []);

  // Index we are scrolling to (or resting on). Scroll events from our own
  // smooth scroll are ignored until it settles, so the dot never flickers.
  const targetRef = useRef(0);
  const animatingRef = useRef(false);
  const settleTimer = useRef<number>(0);

  const readIndex = useCallback(() => {
    const track = trackRef.current;
    const width = step();
    if (!track || !width) return 0;
    const index = Math.round(track.scrollLeft / width);
    return Math.min(slides.length - 1, Math.max(0, index));
  }, [step]);

  const settle = useCallback(() => {
    window.clearTimeout(settleTimer.current);
    animatingRef.current = false;
    const index = readIndex();
    targetRef.current = index;
    setCurrent(index);
  }, [readIndex]);

  const goTo = useCallback(
    (index: number) => {
      const track = trackRef.current;
      if (!track) return;
      targetRef.current = index;
      animatingRef.current = true;
      setCurrent(index);
      track.scrollTo({
        left: index * step(),
        behavior: prefersReducedMotion() ? "auto" : "smooth",
      });
      // `scrollend` settles it; the timer covers browsers without that event.
      window.clearTimeout(settleTimer.current);
      settleTimer.current = window.setTimeout(settle, 1000);
    },
    [step, settle],
  );

  useEffect(() => {
    const track = trackRef.current;
    track?.addEventListener("scrollend", settle);
    return () => {
      track?.removeEventListener("scrollend", settle);
      window.clearTimeout(settleTimer.current);
    };
  }, [settle]);

  const onScroll = () => {
    if (animatingRef.current) return;
    const index = readIndex();
    targetRef.current = index;
    setCurrent(index);
  };

  const move = useCallback(
    (delta: number) =>
      goTo((targetRef.current + delta + slides.length) % slides.length),
    [goTo],
  );

  const moveRef = useRef(move);
  useEffect(() => {
    moveRef.current = move;
  }, [move]);

  const paused = hovered || focused || touched || reduced;
  useEffect(() => {
    if (paused) return;
    const timer = window.setInterval(() => moveRef.current(1), AUTO_ADVANCE_MS);
    return () => window.clearInterval(timer);
  }, [paused]);

  useEffect(() => () => window.clearTimeout(touchTimer.current), []);

  const releaseTouch = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.pointerType !== "touch") return;
    window.clearTimeout(touchTimer.current);
    touchTimer.current = window.setTimeout(() => setTouched(false), 8000);
  };

  return (
    <div
      className={styles.car}
      onPointerEnter={(e) => e.pointerType === "mouse" && setHovered(true)}
      onPointerLeave={(e) => e.pointerType === "mouse" && setHovered(false)}
      onPointerDown={(e) => {
        if (e.pointerType !== "touch") return;
        window.clearTimeout(touchTimer.current);
        setTouched(true);
      }}
      onPointerUp={releaseTouch}
      onPointerCancel={releaseTouch}
      onFocus={() => setFocused(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null))
          setFocused(false);
      }}
    >
      <ul
        ref={trackRef}
        className={styles.track}
        data-carousel-track=""
        onScroll={onScroll}
      >
        {slides.map((slide, i) => (
          <li key={slide.title} className={styles.slide}>
            <div className={styles.pic} role="img" aria-label={slide.label}>
              <div className={styles.inner} aria-hidden="true">
                {slide.picture}
              </div>
            </div>
            <div className={styles.cap}>
              <span className={styles.num}>
                {String(i + 1).padStart(2, "0")}
              </span>
              <div>
                <h3 className={styles.title}>{slide.title}</h3>
                <p className={styles.text}>{slide.text}</p>
              </div>
            </div>
          </li>
        ))}
      </ul>
      <div className={styles.ctl}>
        <div className={styles.dots}>
          {slides.map((slide, i) => (
            <button
              key={slide.title}
              type="button"
              className={styles.dot}
              aria-label={`Slide ${i + 1}`}
              aria-current={i === current ? "true" : undefined}
              onClick={() => goTo(i)}
            />
          ))}
        </div>
        <span className={styles.gap} />
        <button
          type="button"
          className={styles.arrow}
          aria-label="Previous"
          onClick={() => move(-1)}
        >
          <Icon name="arrow-right" size={16} style={{ rotate: "180deg" }} />
        </button>
        <button
          type="button"
          className={styles.arrow}
          aria-label="Next"
          onClick={() => move(1)}
        >
          <Icon name="arrow-right" size={16} />
        </button>
      </div>
    </div>
  );
}
