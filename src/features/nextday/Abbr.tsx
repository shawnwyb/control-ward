import type { ReactNode } from "react";

/**
 * A technical term with its long form. The long form shows on hover and focus, and is read by screen readers.
 * Touch screens have no hover, so the first use of a term on each panel also spells it out in the text.
 */
export function Abbr({
  long,
  children,
}: {
  long: string;
  children: ReactNode;
}) {
  return (
    <abbr title={long} tabIndex={0} style={{ textDecorationStyle: "dotted" }}>
      {children}
    </abbr>
  );
}
