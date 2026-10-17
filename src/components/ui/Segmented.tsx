import { cx } from "./cx";
import styles from "./Segmented.module.css";

type Option<T extends string> = {
  value: T;
  label: string;
  /** Spoken name when the visible label is abbreviated. */
  ariaLabel?: string;
};

type Props<T extends string> = {
  /** Accessible name for the whole group. */
  label: string;
  name: string;
  value: T;
  options: Option<T>[];
  onChange: (value: T) => void;
  className?: string;
};

/**
 * Pick one of a few modes (e.g. a map overlay). Real radio inputs, so arrow
 * keys, focus and screen readers behave natively.
 */
export function Segmented<T extends string>({
  label,
  name,
  value,
  options,
  onChange,
  className,
}: Props<T>) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cx(styles.group, className)}
    >
      {options.map((option) => (
        <label key={option.value} className={styles.option}>
          <input
            type="radio"
            className={styles.input}
            name={name}
            value={option.value}
            aria-label={option.ariaLabel}
            checked={value === option.value}
            onChange={() => onChange(option.value)}
          />
          <span className={styles.face}>{option.label}</span>
        </label>
      ))}
    </div>
  );
}
