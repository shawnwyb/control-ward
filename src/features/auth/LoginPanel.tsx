import { useState, type FormEvent } from "react";
import { Button, Field, Input, Panel } from "../../components/ui";
import { useNotice } from "../../hooks/notice";
import { localDemo, supabase } from "../../lib/supabase";
import styles from "./Auth.module.css";

export function LoginPanel() {
  const { announce } = useNotice();
  const [email, setEmail] = useState(localDemo ? "crew@planit.local" : "");
  const [password, setPassword] = useState(localDemo ? "CrewDemo123!" : "");
  const [signingIn, setSigningIn] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSigningIn(true);
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    setSigningIn(false);
    if (error) announce(error.message, true);
  }

  return (
    <Panel id="login" emphasis className={styles.login}>
      <div className={styles.intro}>
        <h1 className={styles.title}>Sign in to your site</h1>
        <p>Reports and photos are shared with your assigned team.</p>
      </div>
      <form id="login-form" className={styles.form} onSubmit={submit}>
        <Field id="email" label="Email">
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </Field>
        <Field id="password" label="Password">
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </Field>
        <Button
          id="signin"
          type="submit"
          variant="primary"
          block
          busy={signingIn}
        >
          {signingIn ? "Signing in…" : "Sign in →"}
        </Button>
      </form>
      {localDemo ? (
        <div className={styles.demo}>
          <strong>Local test accounts</strong>
          <p>
            North crew: crew@planit.local
            <br />
            South crew: other@planit.local
            <br />
            Both sites: supervisor@planit.local
            <br />
            No access: outsider@planit.local
          </p>
          <p>
            All use <code>CrewDemo123!</code>. Demo sites and reports are
            fictional.
          </p>
        </div>
      ) : null}
    </Panel>
  );
}
