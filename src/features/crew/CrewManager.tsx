import { useState, type FormEvent } from "react";
import {
  Button,
  Field,
  Input,
  Panel,
  PanelHeader,
  StatusTag,
} from "../../components/ui";
import { useNotice } from "../../hooks/notice";
import {
  assignCrewMember,
  isMissingFunction,
  unassignCrewMember,
} from "../../lib/crew";
import { errorMessage } from "../../lib/format";
import type { Site } from "../../lib/types";
import { useSiteCrew } from "./useSiteCrew";
import styles from "./CrewManager.module.css";

type Props = { site: Site; userId: string };

const plural = (count: number, one: string, many: string) =>
  `${count} ${count === 1 ? one : many}`;

/** Says why a roster call failed, in words a supervisor can act on. */
function explain(error: unknown): string {
  return isMissingFunction(error)
    ? "Crew management needs a database update. Ask whoever runs the project to apply the latest migration."
    : errorMessage(error);
}

/** Supervisors: see who has access to this site, add crew by email, and remove crew. */
export function CrewManager({ site, userId }: Props) {
  const { announce } = useNotice();
  const { state, refresh } = useSiteCrew(site.id);
  const [email, setEmail] = useState("");
  const [adding, setAdding] = useState(false);
  // Removing is two steps (Remove, then confirm), so a mis-tap cannot cut someone off.
  const [confirming, setConfirming] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);

  async function add(event: FormEvent) {
    event.preventDefault();
    const address = email.trim();
    if (!address) return;
    setAdding(true);
    try {
      const result = await assignCrewMember(site.id, address);
      announce(
        result.outcome === "assigned"
          ? `Added ${result.email} to ${site.name} as crew.`
          : `${result.email} already has access to ${site.name} as ${result.role}.`,
      );
      setEmail("");
      await refresh();
    } catch (error) {
      announce(explain(error), true);
    } finally {
      setAdding(false);
    }
  }

  async function remove(memberId: string, memberEmail: string) {
    setRemoving(memberId);
    try {
      const removed = await unassignCrewMember(site.id, memberId);
      announce(
        removed
          ? `Removed ${memberEmail} from ${site.name}.`
          : `${memberEmail} no longer has access to ${site.name}.`,
      );
      setConfirming(null);
      await refresh();
    } catch (error) {
      announce(explain(error), true);
    } finally {
      setRemoving(null);
    }
  }

  const members = state.status === "ready" ? state.members : [];
  const crew = members.filter((member) => member.role === "crew");
  const supervisors = members.filter((member) => member.role === "supervisor");

  return (
    <Panel emphasis className={styles.panel} aria-labelledby="crew-title">
      <PanelHeader
        titleId="crew-title"
        title={`Crew at ${site.name}`}
        description="Add people who already have an account. They get crew access to this site only."
      />

      <form className={styles.add} onSubmit={add}>
        <Field
          id="crew-email"
          label="Email address"
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

      {state.status === "loading" ? (
        <p className={styles.note}>Loading crew…</p>
      ) : null}

      {state.status === "error" ? (
        <div className={styles.error}>
          <p>
            <strong>The crew list could not be loaded.</strong>{" "}
            {state.needsMigration
              ? "Crew management needs a database update. Ask whoever runs the project to apply the latest migration."
              : state.message}
          </p>
          {state.needsMigration ? null : (
            <Button variant="secondary" onClick={() => void refresh()}>
              Try again
            </Button>
          )}
        </div>
      ) : null}

      {state.status === "ready" ? (
        <>
          <p className={styles.counts} aria-live="polite">
            {plural(crew.length, "crew member", "crew members")},{" "}
            {plural(supervisors.length, "supervisor", "supervisors")}
          </p>
          <ul
            className={styles.roster}
            aria-label={`People with access to ${site.name}`}
          >
            {members.map((member) => {
              const isCrew = member.role === "crew";
              return (
                <li
                  key={member.user_id}
                  className={styles.row}
                  data-user-id={member.user_id}
                  data-role={member.role}
                >
                  <span className={styles.email}>
                    {member.email}
                    {member.user_id === userId ? (
                      <span className={styles.you}> (you)</span>
                    ) : null}
                  </span>
                  <StatusTag>{isCrew ? "Crew" : "Supervisor"}</StatusTag>
                  {isCrew ? (
                    confirming === member.user_id ? (
                      <span className={styles.confirm}>
                        <Button
                          variant="danger"
                          busy={removing === member.user_id}
                          onClick={() =>
                            void remove(member.user_id, member.email)
                          }
                        >
                          Remove from site
                        </Button>
                        <Button
                          variant="quiet"
                          onClick={() => setConfirming(null)}
                        >
                          Keep
                        </Button>
                      </span>
                    ) : (
                      <Button
                        variant="quiet"
                        aria-label={`Remove ${member.email} from ${site.name}`}
                        onClick={() => setConfirming(member.user_id)}
                      >
                        Remove
                      </Button>
                    )
                  ) : (
                    <span aria-hidden="true" />
                  )}
                </li>
              );
            })}
          </ul>
          {crew.length === 0 ? (
            <p className={styles.note}>
              No crew are assigned to this site yet. Add someone by email above.
            </p>
          ) : null}
        </>
      ) : null}
    </Panel>
  );
}
