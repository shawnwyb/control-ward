import { useRef, type KeyboardEvent, type ReactNode } from "react";
import { cx } from "./cx";
import styles from "./Tabs.module.css";

type Tab<T extends string> = { value: T; label: string };

type Props<T extends string> = {
  /** Accessible name for the group of tabs. */
  label: string;
  /** Prefix for element ids, so panels can point back at their tab. */
  idBase: string;
  value: T;
  tabs: Tab<T>[];
  onChange: (value: T) => void;
  className?: string;
};

export const tabId = (idBase: string, value: string) =>
  `${idBase}-tab-${value}`;
export const panelId = (idBase: string, value: string) =>
  `${idBase}-panel-${value}`;

/**
 * Switches between views on one page, without changing the URL. Follows the
 * ARIA tabs pattern: arrow keys, Home and End move between tabs, and only the
 * selected tab is in the tab order.
 */
export function Tabs<T extends string>({
  label,
  idBase,
  value,
  tabs,
  onChange,
  className,
}: Props<T>) {
  const refs = useRef(new Map<T, HTMLButtonElement>());

  function onKeyDown(event: KeyboardEvent) {
    const index = tabs.findIndex((tab) => tab.value === value);
    const next =
      event.key === "ArrowRight"
        ? (index + 1) % tabs.length
        : event.key === "ArrowLeft"
          ? (index - 1 + tabs.length) % tabs.length
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? tabs.length - 1
              : -1;
    if (next < 0) return;
    event.preventDefault();
    onChange(tabs[next].value);
    refs.current.get(tabs[next].value)?.focus();
  }

  return (
    <div
      role="tablist"
      aria-label={label}
      className={cx(styles.list, className)}
      onKeyDown={onKeyDown}
    >
      {tabs.map((tab) => {
        const selected = tab.value === value;
        return (
          <button
            key={tab.value}
            ref={(node) => {
              if (node) refs.current.set(tab.value, node);
            }}
            type="button"
            role="tab"
            id={tabId(idBase, tab.value)}
            aria-selected={selected}
            aria-controls={panelId(idBase, tab.value)}
            tabIndex={selected ? 0 : -1}
            className={styles.tab}
            onClick={() => onChange(tab.value)}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}

type PanelProps = {
  idBase: string;
  value: string;
  /** Whether this panel's tab is the selected one. */
  active: boolean;
  children: ReactNode;
};

/** Content for one tab. Hidden, not removed, so its state survives switching tabs. */
export function TabPanel({ idBase, value, active, children }: PanelProps) {
  return (
    <div
      role="tabpanel"
      id={panelId(idBase, value)}
      aria-labelledby={tabId(idBase, value)}
      hidden={!active}
    >
      {children}
    </div>
  );
}
