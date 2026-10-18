import { Icon, type IconName } from "../../components/ui/Icon";
import { Footer } from "../shell/Footer";
import { FeatureCarousel } from "./FeatureCarousel";
import { LiveDemo } from "./LiveDemo";
import { Puzzle } from "./Puzzle";
import styles from "./Landing.module.css";

const story: { icon: IconName; text: string }[] = [
  { icon: "heat", text: "Heat index passes 110°F by noon" },
  { icon: "bolt", text: "Afternoon storms building to the west" },
  { icon: "flood", text: "A week of rain has turned the ground to mud" },
  { icon: "paw", text: "A gator was seen near the site yesterday" },
];

const sources = [
  "EIA-860M",
  "NOAA Storm Events",
  "Iowa Environmental Mesonet",
  "OSHA Severe Injury Reports",
  "National Levee Database",
  "NOAA Tides & Currents",
  "FEMA Flood Maps",
];

function scrollToSection(id: string) {
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  document
    .getElementById(id)
    ?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
}

/** The page judges see first: what the product does, then a way into the live demo. */
export function Landing({ onSignIn }: { onSignIn: () => void }) {
  return (
    <div className={styles.landing}>
      <header className={styles.nav}>
        <span className={styles.logo}>
          <i aria-hidden="true" />
          PlanIT Control
        </span>
        <nav className={styles.links} aria-label="Sections">
          <button type="button" onClick={() => scrollToSection("running")}>
            How it works
          </button>
          <button type="button" onClick={() => scrollToSection("features")}>
            Features
          </button>
          <button type="button" onClick={() => scrollToSection("data")}>
            Data
          </button>
        </nav>
        <span className={styles.spacer} />
        <button type="button" className={styles.signIn} onClick={onSignIn}>
          Sign in
        </button>
        <button type="button" className={styles.btn} onClick={onSignIn}>
          Open live demo
        </button>
      </header>

      <section className={styles.hero}>
        <div className={styles.copy}>
          <span className={styles.eyebrow}>
            <Icon name="bolt" size={13} />
            Built for utility field crews · SwampHacks 2026
          </span>
          <h1 className={styles.h1}>
            Every hazard on site. <br />
            <em>One picture.</em>
          </h1>
          <div className={styles.actions}>
            <button type="button" className={styles.btn} onClick={onSignIn}>
              Open live demo →
            </button>
            <button
              type="button"
              className={`${styles.btn} ${styles.ghost}`}
              onClick={() => scrollToSection("running")}
            >
              See how it works
            </button>
          </div>
        </div>
        <Puzzle />
      </section>

      <section className={styles.section} aria-labelledby="story-title">
        <h2 id="story-title" className={styles.h2}>
          6:45 AM, the Everglades.
        </h2>
        <p className={styles.lede}>
          A crew is about to build a temporary road for a new transmission line.
          Every one of these hazards was knowable ahead of time, but the data
          was spread across a dozen apps.
        </p>
        <ul className={styles.story}>
          {story.map((item) => (
            <li key={item.text} className={styles.card}>
              <Icon name={item.icon} size={18} />
              <span>{item.text}</span>
            </li>
          ))}
        </ul>
      </section>

      <section
        id="features"
        className={styles.section}
        aria-labelledby="features-title"
      >
        <h2 id="features-title" className={styles.h2}>
          What PlanIT Control does
        </h2>
        <p className={styles.lede}>
          Six pieces that fit together. Hover to pause.
        </p>
        <FeatureCarousel />
      </section>

      <section
        id="running"
        className={styles.section}
        aria-labelledby="running-title"
      >
        <h2 id="running-title" className={styles.h2}>
          See it running
        </h2>
        <p className={styles.lede}>
          A lightning strike near Big Cypress Sub, live in the supervisor view.
        </p>
        <LiveDemo />
      </section>

      <section
        id="data"
        className={styles.section}
        aria-labelledby="data-title"
      >
        <h2 id="data-title" className={styles.h2}>
          Built on public data
        </h2>
        <p className={styles.lede}>
          Real power plant locations and decades of weather and incident
          history.
        </p>
        <ul className={styles.sources}>
          {sources.map((name) => (
            <li key={name} className={styles.pill}>
              {name}
            </li>
          ))}
        </ul>
      </section>

      <section className={styles.cta}>
        <h2 className={styles.h2}>Plan ahead instead of reacting.</h2>
        <p className={styles.lede}>Try it with 50+ real power plant sites.</p>
        <button type="button" className={styles.btn} onClick={onSignIn}>
          Open live demo →
        </button>
      </section>

      <div className={styles.foot}>
        <Footer />
      </div>
    </div>
  );
}
