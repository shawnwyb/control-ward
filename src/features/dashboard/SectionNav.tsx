import styles from "./Dashboard.module.css";

const sections = [
  ["risk", "Risk"],
  ["plan", "Plan"],
  ["crew", "Crew"],
  ["push", "Push"],
  ["site-map", "Map"],
  ["site-reports", "Reports"],
] as const;

export function scrollToSection(id: string) {
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  document.getElementById(id)?.scrollIntoView({
    behavior: reduced ? "auto" : "smooth",
    block: "start",
  });
}

/** Phones get a long page: a sticky row of anchors keeps every section one tap away. */
export function SectionNav() {
  return (
    <nav className={styles.sectionNav} aria-label="Sections">
      {sections.map(([id, label]) => (
        <a
          key={id}
          href={`#${id}`}
          onClick={(event) => {
            event.preventDefault();
            scrollToSection(id);
          }}
        >
          {label}
        </a>
      ))}
    </nav>
  );
}
