import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

type BusyApi = {
  /** Reactive value for rendering (disables controls). */
  busy: boolean;
  /** Synchronous check for event handlers, so double taps cannot race. */
  isBusy: () => boolean;
  setBusy: (value: boolean) => void;
};

const BusyContext = createContext<BusyApi | undefined>(undefined);

/** One write at a time: reporting, check-ins and sign-out share this lock. */
export function BusyProvider({ children }: { children: ReactNode }) {
  const [busy, setBusyState] = useState(false);
  const ref = useRef(false);
  const setBusy = useCallback((value: boolean) => {
    ref.current = value;
    setBusyState(value);
  }, []);
  const isBusy = useCallback(() => ref.current, []);
  const value = useMemo(
    () => ({ busy, isBusy, setBusy }),
    [busy, isBusy, setBusy],
  );
  return <BusyContext.Provider value={value}>{children}</BusyContext.Provider>;
}

export function useBusy(): BusyApi {
  const value = useContext(BusyContext);
  if (!value) throw new Error("useBusy must be used inside BusyProvider");
  return value;
}
