import { Component, type ErrorInfo, type ReactNode } from "react";

type Props = {
  /** Shown instead of `children` if rendering them throws. */
  fallback: ReactNode;
  children: ReactNode;
};

/**
 * Keeps a failure in one optional part of the screen (e.g. the map) from
 * taking the rest of the app down with it.
 */
export class ErrorBoundary extends Component<Props, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(
      "Part of the screen failed to render:",
      error,
      info.componentStack,
    );
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
