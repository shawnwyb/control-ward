import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";

export type SessionState =
  | { status: "loading" }
  | { status: "signedOut" }
  | { status: "signedIn"; userId: string; email: string };

function toState(session: Session | null): SessionState {
  return session
    ? {
        status: "signedIn",
        userId: session.user.id,
        email: session.user.email ?? "",
      }
    : { status: "signedOut" };
}

export function useSession(): SessionState {
  const [state, setState] = useState<SessionState>({ status: "loading" });
  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      // Keep state updates outside the Auth callback's session lock, and ignore
      // token refreshes for a user we already know.
      setTimeout(() => {
        const next = toState(session);
        setState((previous) =>
          previous.status === "signedIn" &&
          next.status === "signedIn" &&
          previous.userId === next.userId
            ? previous
            : next,
        );
      }, 0);
    });
    return () => data.subscription.unsubscribe();
  }, []);
  return state;
}
