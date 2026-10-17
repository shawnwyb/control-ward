import { useState } from "react";
import { Button } from "../../components/ui";
import { useNotice } from "../../hooks/notice";
import { describeCrewError, unassignCrewMember } from "../../lib/crew";
import styles from "./CrewAccess.module.css";

type Props = {
  siteId: string;
  siteName: string;
  member: { user_id: string; name: string; email: string };
  onChanged: () => void;
};

/** Remove a crew member from the site. Two steps, so a mis-tap cannot cut someone off. */
export function RemoveCrew({ siteId, siteName, member, onChanged }: Props) {
  const { announce } = useNotice();
  const [confirming, setConfirming] = useState(false);
  const [removing, setRemoving] = useState(false);

  async function remove() {
    setRemoving(true);
    try {
      const removed = await unassignCrewMember(siteId, member.user_id);
      announce(
        removed
          ? `Removed ${member.email} from ${siteName}.`
          : `${member.email} no longer has access to ${siteName}.`,
      );
      onChanged();
    } catch (error) {
      announce(describeCrewError(error), true);
      setRemoving(false);
    }
  }

  return confirming ? (
    <span className={styles.confirm}>
      <Button variant="danger" busy={removing} onClick={() => void remove()}>
        Remove from site
      </Button>
      <Button
        variant="quiet"
        disabled={removing}
        onClick={() => setConfirming(false)}
      >
        Keep
      </Button>
    </span>
  ) : (
    <Button
      variant="quiet"
      aria-label={`Remove ${member.name} from ${siteName}`}
      onClick={() => setConfirming(true)}
    >
      Remove
    </Button>
  );
}
