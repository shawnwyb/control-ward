import styles from "./Footer.module.css";

export function Footer() {
  return (
    <footer className={styles.footer}>
      <div className={styles.inner}>
        <strong className={styles.name}>ControlWard</strong>
        <span>
          Field observations inform your site’s risk. Follow your team’s safety
          procedures.
        </span>
      </div>
    </footer>
  );
}
