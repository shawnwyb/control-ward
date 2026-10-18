import { useEffect, useState, type ReactNode } from "react";
import { Icon } from "../../components/ui";
import { Footer } from "./Footer";
import styles from "./AppShell.module.css";

/**
 * Sidebar on the left, one page at a time on the right. Under 48rem the sidebar
 * becomes a drawer behind a menu button, and closes when a page is chosen.
 */
export function AppShell({
  sidebar,
  pageKey,
  children,
}: {
  sidebar: ReactNode;
  /** Changes with the page, so each page fades in. */
  pageKey?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <div id="workspace" className={styles.shell} data-menu={open || undefined}>
      <header className={styles.bar}>
        <button
          type="button"
          className={styles.menu}
          aria-label="Menu"
          aria-expanded={open}
          aria-controls="sidebar"
          onClick={() => setOpen((current) => !current)}
        >
          <Icon name="menu" size={18} />
        </button>
        <span className={styles.title}>PlanIT Control</span>
      </header>
      <div
        id="sidebar"
        className={styles.side}
        onClick={(event) => {
          if ((event.target as Element).closest("a")) setOpen(false);
        }}
      >
        {sidebar}
      </div>
      <div className={styles.scrim} onClick={() => setOpen(false)} />
      <main className={styles.main}>
        <div key={pageKey} className={styles.page}>
          {children}
        </div>
        <Footer />
      </main>
    </div>
  );
}
