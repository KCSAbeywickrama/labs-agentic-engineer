/**
 * Copyright (c) 2026, WSO2 LLC. (https://www.wso2.com).
 *
 * WSO2 LLC. licenses this file to you under the Apache License,
 * Version 2.0 (the "License"); you may not use this file except
 * in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 * KIND, either express or implied.  See the License for the
 * specific language governing permissions and limitations
 * under the License.
 */

import { Component, useState, type ErrorInfo, type ReactNode } from "react";
import { Box, Button, Collapse, Typography, type SxProps, type Theme } from "@wso2/oxygen-ui";
import { TriangleAlert } from "@wso2/oxygen-ui-icons-react";
import { EmptyState } from "./EmptyState";

// A render-time throw anywhere in the console used to reach TanStack Router's
// top-level catch, which swaps the WHOLE shell (nav, header, chat) for its
// default "Something went wrong / Show Error" page. Nothing recorded the
// stack, and only a page reload brought the app back.
//
// This boundary contains such a throw to the section it wraps — a page, the
// chat panel, the wireframe canvas — so the rest of the workspace keeps
// working, and it records what happened so the next occurrence can be fixed
// at its source. It is containment, not a fix: the root cause of a throw
// stays a bug to chase with the stack this component now surfaces.
//
// Recovery, in order:
//   1. New input. The parent passes `resetKey` — the scene a canvas draws,
//      the pathname a page renders — and a change clears the error.
//   2. Bounded automatic retry. The observed failures behave like timing
//      races (a reload of the SAME content renders fine), so the boundary
//      retries the same children after a short wait. It stops after
//      RETRY_DELAYS_MS runs out: a deterministic throw must not become a
//      fallback that flashes forever and hides the bug.
//   3. The "Try again" button, which also gives the automatic attempts back.

/** Waits before each automatic retry; the list's length is the attempt cap. */
const RETRY_DELAYS_MS: readonly number[] = [2_000, 5_000];

interface ErrorBoundaryProps {
  children: ReactNode;
  /** What the reader was looking at, in a sentence fragment: "The wireframe canvas". */
  label: string;
  /** A change here clears the error and resets the automatic attempts. */
  resetKey?: unknown;
  /** Fallback stretches to fill a flex column (the canvas, the chat panel). */
  fill?: boolean;
  /** Extra sizing for the fallback when the children set their own (the chat panel's width). */
  fallbackSx?: SxProps<Theme>;
}

interface ErrorBoundaryState {
  error: Error | null;
  componentStack: string | null;
  /** Automatic retries spent on the current run of failures. */
  attempts: number;
  /** An automatic retry is scheduled. */
  retryPending: boolean;
}

const CLEAR: ErrorBoundaryState = {
  error: null,
  componentStack: null,
  attempts: 0,
  retryPending: false,
};

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = CLEAR;
  private timer: ReturnType<typeof setTimeout> | null = null;

  static getDerivedStateFromError(error: unknown): Partial<ErrorBoundaryState> {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    // The one place the stack is recorded. Logged, not swallowed: without
    // this the fallback would hide the very evidence needed to fix the cause.
    console.error(`[console] ${this.props.label} failed to render`, error, info.componentStack);
    const componentStack = info.componentStack ?? null;
    const delay = RETRY_DELAYS_MS[this.state.attempts];
    if (delay === undefined) {
      this.setState({ componentStack, retryPending: false });
      return;
    }
    this.setState({ componentStack, retryPending: true });
    this.timer = setTimeout(() => {
      this.timer = null;
      this.setState((s) => ({ error: null, componentStack: null, attempts: s.attempts + 1, retryPending: false }));
    }, delay);
  }

  override componentDidUpdate(prev: ErrorBoundaryProps) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.reset();
  }

  override componentWillUnmount() {
    this.clearTimer();
  }

  private clearTimer() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private reset = () => {
    this.clearTimer();
    this.setState(CLEAR);
  };

  override render() {
    const { error, componentStack, retryPending } = this.state;
    if (!error) return this.props.children;
    return (
      <ErrorFallback
        label={this.props.label}
        error={error}
        componentStack={componentStack}
        retryPending={retryPending}
        onRetry={this.reset}
        fill={this.props.fill ?? false}
        sx={this.props.fallbackSx}
      />
    );
  }
}

function ErrorFallback({
  label,
  error,
  componentStack,
  retryPending,
  onRetry,
  fill,
  sx,
}: {
  label: string;
  error: Error;
  componentStack: string | null;
  retryPending: boolean;
  onRetry: () => void;
  fill: boolean;
  sx?: SxProps<Theme> | undefined;
}) {
  const [showDetails, setShowDetails] = useState(false);
  const details = [error.stack ?? `${error.name}: ${error.message}`, componentStack?.trim()]
    .filter(Boolean)
    .join("\n\nComponent stack:\n");
  return (
    <Box
      role="alert"
      sx={[
        {
          ...(fill && { flex: 1, minHeight: 0, minWidth: 0, display: "flex", flexDirection: "column", justifyContent: "center" }),
          overflow: "auto",
        },
        ...(Array.isArray(sx) ? sx : [sx]),
      ]}
    >
      <EmptyState
        icon={<TriangleAlert size={48} />}
        title="Something went wrong"
        description={
          retryPending
            ? `${label} hit an error while rendering. Retrying automatically…`
            : `${label} hit an error while rendering. Try again, or reload the page if it keeps happening.`
        }
        action={
          <Box sx={{ display: "flex", gap: 1, justifyContent: "center" }}>
            <Button variant="contained" onClick={onRetry}>
              Try again
            </Button>
            <Button variant="text" onClick={() => setShowDetails((v) => !v)} aria-expanded={showDetails}>
              {showDetails ? "Hide details" : "Details"}
            </Button>
          </Box>
        }
      />
      <Collapse in={showDetails} unmountOnExit>
        <Typography
          component="pre"
          variant="caption"
          sx={{
            mx: 2,
            mb: 2,
            p: 1.5,
            textAlign: "left",
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            bgcolor: "action.hover",
            borderRadius: 1,
            maxHeight: 320,
            overflow: "auto",
            userSelect: "text",
          }}
        >
          {details}
        </Typography>
      </Collapse>
    </Box>
  );
}
