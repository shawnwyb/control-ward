import { Panel } from "../../components/ui";

export function NoSites() {
  return (
    <Panel id="no-sites">
      <h2>No sites assigned</h2>
      <p>
        Your account has no site access. Ask your supervisor to assign your
        crew.
      </p>
    </Panel>
  );
}
