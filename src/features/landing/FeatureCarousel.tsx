import {
  useCallback,
  useEffect,
  useRef,
  useState,
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

  const goTo = useCallback(
    (index: number) => {
      const track = trackRef.current;
      if (!track) return;
      track.scrollTo({
        left: index * step(),
        behavior: prefersReducedMotion() ? "auto" : "smooth",
      });
      setCurrent(index);
    },
    [step],
  );

  const onScroll = () => {
    const track = trackRef.current;
    const width = step();
    if (!track || !width) return;
    const index = Math.round(track.scrollLeft / width);
    setCurrent(Math.min(slides.length - 1, Math.max(0, index)));
  };

  const move = useCallback(
    (delta: number) => goTo((current + delta + slides.length) % slides.length),
    [current, goTo],
  );

  const paused = hovered || focused || reduced;
  useEffect(() => {
    if (paused) return;
    const timer = window.setInterval(() => move(1), AUTO_ADVANCE_MS);
    return () => window.clearInterval(timer);
  }, [paused, move]);

  return (
    <div
      className={styles.car}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
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
