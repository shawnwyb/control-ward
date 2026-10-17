import styles from "./AlertList.module.css";

type Props = { clearAt: Date; now: number };

/**
 * Time left until a lightning stop-work alert would clear. The ticking digits
 * are hidden from screen readers (they would announce every second); a plain
 * minutes estimate is provided instead.
 */
export function Countdown({ clearAt, now }: Props) {
  const seconds = Math.max(0, Math.round((clearAt.getTime() - now) / 1000));
  if (seconds === 0)
    return (
      <p className={styles.countdown}>
        The countdown has finished. The alert clears at the next update.
      </p>
    );
  const minutes = Math.floor(seconds / 60);
  return (
    <p className={styles.countdown}>
      <span>Clears in </span>
      <time className={styles.clock} aria-hidden="true">
        {minutes}:{String(seconds % 60).padStart(2, "0")}
      </time>
      <span className="sr-only">about {Math.ceil(seconds / 60)} minutes</span>
      <span> if there is no new strike.</span>
    </p>
  );
}
