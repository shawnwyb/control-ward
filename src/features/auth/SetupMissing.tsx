import page from "../shell/Page.module.css";
import styles from "./Auth.module.css";

export function SetupMissing() {
  return (
    <main className={`${page.page} ${styles.setup}`}>
      <h1>Start your local crew workspace</h1>
      <p>
        Run <code>npm run local:start</code> and{" "}
        <code>npm run local:reset</code>, then restart the development server.
      </p>
    </main>
  );
}
