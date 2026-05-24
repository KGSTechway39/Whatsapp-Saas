"use client";

import { Component, type ReactNode } from "react";
import { AlertTriangle, RefreshCw, Home } from "lucide-react";
import Link from "next/link";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorId: string | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null, errorId: null };
  }

  static getDerivedStateFromError(error: Error): State {
    const errorId = `ERR-${Date.now().toString(36).toUpperCase()}`;
    return { hasError: true, error, errorId };
  }

  componentDidCatch(error: Error, info: { componentStack: string }) {
    // In production, ship this to Sentry / Datadog
    console.error("[ErrorBoundary]", {
      message: error.message,
      stack:   error.stack,
      component: info.componentStack,
    });
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;

      return (
        <div className="flex flex-col items-center justify-center min-h-[400px] p-8 text-center">
          <div className="w-16 h-16 rounded-2xl bg-red-500/10 flex items-center justify-center mb-6">
            <AlertTriangle className="w-8 h-8 text-red-400" />
          </div>
          <h2 className="text-xl font-bold mb-2">Something went wrong</h2>
          <p className="text-sm text-muted-foreground max-w-md mb-1">
            An unexpected error occurred. Our team has been notified.
          </p>
          {this.state.errorId && (
            <p className="text-xs text-muted-foreground/60 mb-6 font-mono">
              Error ID: {this.state.errorId}
            </p>
          )}
          <div className="flex items-center gap-3">
            <button
              onClick={() => this.setState({ hasError: false, error: null, errorId: null })}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-primary text-white text-sm font-medium hover:opacity-90 transition-all"
            >
              <RefreshCw className="w-4 h-4" />
              Try again
            </button>
            <Link
              href="/dashboard"
              className="flex items-center gap-2 px-4 py-2 rounded-xl border border-border text-sm font-medium hover:bg-accent transition-all"
            >
              <Home className="w-4 h-4" />
              Go home
            </Link>
          </div>
          {process.env.NODE_ENV !== "production" && this.state.error && (
            <details className="mt-6 text-left w-full max-w-2xl">
              <summary className="text-xs text-muted-foreground cursor-pointer">
                Technical details (dev only)
              </summary>
              <pre className="mt-2 text-xs bg-muted/50 p-4 rounded-xl overflow-auto text-red-400 whitespace-pre-wrap">
                {this.state.error.message}
                {"\n\n"}
                {this.state.error.stack}
              </pre>
            </details>
          )}
        </div>
      );
    }

    return this.props.children;
  }
}
