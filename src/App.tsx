import { useEffect } from "react";
import { BusyProvider, useBusy } from "./hooks/busy";
import { NoticeProvider, useNotice } from "./hooks/notice";
import { useSession } from "./hooks/useSession";
import { Notice } from "./components/ui";
import { LoginPanel } from "./features/auth/LoginPanel";
import { SetupMissing } from "./features/auth/SetupMissing";
import { Footer } from "./features/shell/Footer";
import page from "./features/shell/Page.module.css";
import { Topbar } from "./features/shell/Topbar";
import { Workspace } from "./features/workspace/Workspace";
import { discardPhoto, resetPending } from "./lib/submission";
import { isConfigured, supabase } from "./lib/supabase";

function Shell() {
  const session = useSession();
  const { notice, announce, clear } = useNotice();
  const { busy, isBusy } = useBusy();
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

  return (
    <>
      <Topbar
        email={session.status === "signedIn" ? session.email : undefined}
        onSignOut={
          session.status === "signedIn" ? () => void signOut() : undefined
        }
        busy={busy}
      />
      <main className={page.page}>
        {session.status === "signedIn" ? (
          <Workspace key={session.userId} />
        ) : session.status === "signedOut" ? (
          <LoginPanel />
        ) : null}
      </main>
      <Footer />
      <Notice message={notice?.message} tone={notice?.tone} onDismiss={clear} />
    </>
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
