import { Button } from "./Button";
import { Icon } from "./Icon";
import { cx } from "./cx";
import styles from "./TimeSlider.module.css";

type Props = {
  label: string;
  /** Index of the current step, 0 … max. */
  value: number;
  max: number;
  /** What the current step means, e.g. "1:48 PM, 12 minutes ago". */
  valueText: string;
  playing: boolean;
  onChange: (value: number) => void;
  onTogglePlay: () => void;
  className?: string;
};

/** Play button, scrubber and readout for stepping through time-ordered frames. */
export function TimeSlider({
  label,
  value,
  max,
  valueText,
  playing,
  onChange,
  onTogglePlay,
  className,
}: Props) {
  return (
    <div className={cx(styles.slider, className)}>
      <Button
        variant="secondary"
        className={styles.play}
        aria-label={playing ? `Pause ${label}` : `Play ${label}`}
        icon={<Icon name={playing ? "pause" : "play"} />}
        onClick={onTogglePlay}
      />
      <input
        type="range"
        className={styles.range}
        aria-label={label}
        aria-valuetext={valueText}
        min={0}
        max={max}
        step={1}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      <output className={styles.readout}>{valueText}</output>
    </div>
  );
}
