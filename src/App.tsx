import { useEffect } from "react";
import { BusyProvider, useBusy } from "./hooks/busy";
import { NoticeProvider, useNotice } from "./hooks/notice";
import { useSession } from "./hooks/useSession";
import { Notice } from "./components/ui";
import { LoginPanel } from "./features/auth/LoginPanel";
import { SetupMissing } from "./features/auth/SetupMissing";
import page from "./features/shell/Page.module.css";
import { Workspace } from "./features/workspace/Workspace";
import { useRoute } from "./lib/route";
import { discardPhoto, resetPending } from "./lib/submission";
import { isConfigured, supabase } from "./lib/supabase";

function Shell() {
  const session = useSession();
  const { notice, announce, clear } = useNotice();
  const { isBusy } = useBusy();
  const userId = session.status === "signedIn" ? session.userId : undefined;

  // A different user (or sign-out) starts from a blank slate.
  useEffect(() => {
    clear();
    if (!userId) resetPending();
  }, [userId, clear]);

  async function signOut() {
    if (isBusy()) return;
    await discardPhoto();
    const { error } = await supabase.auth.signOut();
    if (error) announce(error.message, true);
  }

  const [route, setRoute] = useRoute();
  const signedOut = session.status === "signedOut";
  // Signed out, anything but the landing page is the sign-in page.
  useEffect(() => {
    if (signedOut && route !== "landing" && route !== "sign-in")
      setRoute("sign-in", true);
  }, [signedOut, route, setRoute]);

  return (
    <>
      {session.status === "signedIn" ? (
        <Workspace
          key={session.userId}
          userId={session.userId}
          email={session.email}
          onSignOut={() => void signOut()}
        />
      ) : signedOut ? (
        <main className={page.page}>
          {route === "landing" ? <LandingPlaceholder /> : <LoginPanel />}
        </main>
      ) : null}
      <Notice message={notice?.message} tone={notice?.tone} onDismiss={clear} />
    </>
  );
}

/** Stands in until the real landing page arrives. */
function LandingPlaceholder() {
  return (
    <section>
      <h1>PlanIT Control</h1>
      <p>
        <a href="#/sign-in">Sign in</a>
      </p>
    </section>
  );
}

export function App() {
  if (!isConfigured) return <SetupMissing />;
  return (
    <NoticeProvider>
      <BusyProvider>
        <Shell />
      </BusyProvider>
    </NoticeProvider>
  );
}
