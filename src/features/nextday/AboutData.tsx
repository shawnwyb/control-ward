import { useEffect, useRef, type ReactNode } from "react";
import styles from "./NextDayReport.module.css";

/**
 * Source notes and secondary caveats, folded away. The caveat that changes a decision stays visible next to the
 * numbers. Folded notes open while the page prints, so paper keeps the sources and caveats.
 */
export function AboutData({
  children,
  label = "About this data",
}: {
  children: ReactNode;
  label?: string;
}) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    let wasOpen = false;
    const open = () => {
      wasOpen = ref.current?.open ?? false;
      if (ref.current) ref.current.open = true;
    };
    const restore = () => {
      if (ref.current) ref.current.open = wasOpen;
    };
    window.addEventListener("beforeprint", open);
    window.addEventListener("afterprint", restore);
    return () => {
      window.removeEventListener("beforeprint", open);
      window.removeEventListener("afterprint", restore);
    };
  }, []);
  return (
    <details ref={ref} className={styles.about}>
      <summary>{label}</summary>
      <div>{children}</div>
    </details>
  );
}
