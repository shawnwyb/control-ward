import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

type NoticeState = { message: string; tone: "success" | "error" };
type NoticeApi = {
  notice: NoticeState | undefined;
  announce: (message: string, error?: boolean) => void;
  clear: () => void;
};

const SUCCESS_VISIBLE_MS = 6000;
const NoticeContext = createContext<NoticeApi | undefined>(undefined);

export function NoticeProvider({ children }: { children: ReactNode }) {
  const [notice, setNotice] = useState<NoticeState>();
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const clear = useCallback(() => {
    clearTimeout(timer.current);
    setNotice(undefined);
  }, []);
  const announce = useCallback((message: string, error = false) => {
    clearTimeout(timer.current);
    setNotice({ message, tone: error ? "error" : "success" });
    // Successes tidy themselves up; errors stay until dismissed or replaced.
    if (!error)
      timer.current = setTimeout(
        () => setNotice(undefined),
        SUCCESS_VISIBLE_MS,
      );
  }, []);
  useEffect(() => () => clearTimeout(timer.current), []);
  const value = useMemo(
    () => ({ notice, announce, clear }),
    [notice, announce, clear],
  );
  return (
    <NoticeContext.Provider value={value}>{children}</NoticeContext.Provider>
  );
}

export function useNotice(): NoticeApi {
  const value = useContext(NoticeContext);
  if (!value) throw new Error("useNotice must be used inside NoticeProvider");
  return value;
}
