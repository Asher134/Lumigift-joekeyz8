"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";
import * as Sentry from "@sentry/nextjs";

interface GiftFlowErrorBoundaryProps {
  children: ReactNode;
}

interface GiftFlowErrorBoundaryState {
  hasError: boolean;
}

export class GiftFlowErrorBoundary extends Component<
  GiftFlowErrorBoundaryProps,
  GiftFlowErrorBoundaryState
> {
  state: GiftFlowErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): GiftFlowErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    Sentry.withScope((scope) => {
      scope.setTag("component", "gift-flow");
      scope.setExtra("componentStack", errorInfo.componentStack);
      Sentry.captureException(error);
    });
  }

  private handleRetry = () => {
    this.setState({ hasError: false });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div role="alert" className="container">
          <p>We couldn&apos;t load the gift form. Please try again.</p>
          <button type="button" className="btn btn--primary" onClick={this.handleRetry}>
            Try again
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
