import { useState, type FormEvent } from "react";
import { Button, Field, Input } from "../../components/ui";
import { useNotice } from "../../hooks/notice";
import { assignCrewMember, describeCrewError } from "../../lib/crew";
import styles from "./CrewAccess.module.css";

type Props = { siteId: string; siteName: string; onChanged: () => void };

/** Supervisors: give an existing account crew access to this site. */
export function CrewAccess({ siteId, siteName, onChanged }: Props) {
  const { announce } = useNotice();
  const [email, setEmail] = useState("");
  const [adding, setAdding] = useState(false);

  async function add(event: FormEvent) {
    event.preventDefault();
    const address = email.trim();
    if (!address) return;
    setAdding(true);
    try {
      const result = await assignCrewMember(siteId, address);
      announce(
        result.outcome === "assigned"
          ? `Added ${result.email} to ${siteName} as crew.`
          : `${result.email} already has access to ${siteName} as ${result.role}.`,
      );
      setEmail("");
      onChanged();
    } catch (error) {
      announce(describeCrewError(error), true);
    } finally {
      setAdding(false);
    }
  }

  return (
    <form className={styles.add} onSubmit={add}>
      <Field
        id="crew-email"
        label="Add crew by email"
        hint="The person must already have an account."
        className={styles.addField}
      >
        <Input
          id="crew-email"
          name="email"
          type="email"
          autoComplete="off"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
      </Field>
      <Button type="submit" variant="primary" busy={adding}>
        {adding ? "Adding…" : "Add to site"}
      </Button>
    </form>
  );
}
