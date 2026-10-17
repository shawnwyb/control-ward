import { Icon, iconMarkup, type IconName } from "./Icon";
import styles from "./IconTile.module.css";

/** The hazard icon in its bordered tile. Same look in the feed and on the map. */
export function IconTile({ name }: { name: IconName }) {
  return (
    <span className={styles.tile}>
      <Icon name={name} size={24} />
    </span>
  );
}

/** For DOM built outside React (map popups). */
export function iconTileMarkup(name: IconName): string {
  return `<span class="${styles.tile}">${iconMarkup(name, 24)}</span>`;
}
