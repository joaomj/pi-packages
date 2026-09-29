import { describe, expect, it } from "vitest";
import {
  initialPromptState,
  type PromptModelConfig,
  type PromptOutcome,
  reducePrompt,
  visibleActions,
} from "#src/authority/permission-prompt-decision";
import { DEFAULT_DIALOG_KEYS } from "#src/config/dialog-keys";

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Narrow a reducer outcome to its render arm, failing the test if it decided.
 *
 * An assertion signature rather than a bare `throw`: reading `.state` off the
 * union needs narrowing, but a `throw` reports outside the assertion library,
 * so a wrong arm arrives as a stack trace naming neither what was expected nor
 * what came back. `expect.unreachable` returns `never`, so it narrows and
 * reports.
 */
function assertRender(
  outcome: PromptOutcome,
): asserts outcome is Extract<PromptOutcome, { kind: "render" }> {
  if (outcome.kind !== "render") {
    expect.unreachable(`expected a render, got ${JSON.stringify(outcome)}`);
  }
}

function makeConfig(
  overrides: Partial<PromptModelConfig> = {},
): PromptModelConfig {
  return {
    doublePressToConfirm: true,
    sessionLabel: "Yes, for this session",
    keys: DEFAULT_DIALOG_KEYS,
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe("reducePrompt", () => {
  it("offers only approve and deny", () => {
    expect(visibleActions()).toEqual(["approve", "deny"]);
  });

  it("arms before approving and names the configured key", () => {
    const config = makeConfig({
      keys: { approve: "1", deny: "2" },
      widthLabel: "Read and write",
    });
    const armed = reducePrompt(config, initialPromptState(config), {
      type: "hotkey",
      action: "approve",
    });
    assertRender(armed);
    expect(armed.state.hint).toBe("Press 1 again to approve for this session.");
    expect(
      reducePrompt(config, armed.state, { type: "hotkey", action: "approve" }),
    ).toEqual({
      kind: "decision",
      decision: {
        approved: true,
        state: "approved_for_session",
        sessionGrantWidth: "family",
      },
    });
  });

  it("changing keys re-arms rather than committing", () => {
    const config = makeConfig();
    const armed = reducePrompt(config, initialPromptState(config), {
      type: "hotkey",
      action: "approve",
    });
    assertRender(armed);
    const changed = reducePrompt(config, armed.state, {
      type: "hotkey",
      action: "deny",
    });
    assertRender(changed);
    expect(changed.state.armedAction).toBe("deny");
    expect(changed.state.step).toBe("decision");
    expect(changed.state.hint).toBe(
      "Press n again to provide a denial reason.",
    );
  });

  it("navigation clears arming and wraps across only two choices", () => {
    const config = makeConfig();
    const armed = reducePrompt(config, initialPromptState(config), {
      type: "hotkey",
      action: "approve",
    });
    assertRender(armed);
    let state = armed.state;
    const seen: string[] = [];
    for (const direction of ["down", "down", "up", "up"] as const) {
      const outcome = reducePrompt(config, state, { type: "nav", direction });
      assertRender(outcome);
      state = outcome.state;
      expect(state.armedAction).toBeUndefined();
      seen.push(state.highlightedAction);
    }
    expect(seen).toEqual(["deny", "approve", "deny", "approve"]);
  });

  it("Enter approves the highlighted scope for the session", () => {
    const config = makeConfig();
    expect(
      reducePrompt(config, initialPromptState(config), { type: "confirm" }),
    ).toEqual({
      kind: "decision",
      decision: { approved: true, state: "approved_for_session" },
    });
  });

  it("requires a nonblank denial reason and trims it", () => {
    const config = makeConfig({ doublePressToConfirm: false });
    const opened = reducePrompt(config, initialPromptState(config), {
      type: "hotkey",
      action: "deny",
    });
    assertRender(opened);
    expect(opened.state.step).toBe("reason");
    const empty = reducePrompt(config, opened.state, {
      type: "submitReason",
      draft: "  ",
    });
    assertRender(empty);
    expect(empty.state.reasonError).toBe("A reason is required.");
    expect(
      reducePrompt(config, empty.state, {
        type: "submitReason",
        draft: "  not now  ",
      }),
    ).toEqual({
      kind: "decision",
      decision: {
        approved: false,
        state: "denied_with_reason",
        denialReason: "not now",
      },
    });
  });

  it.each(["deny", "approve"] as const)(
    "canceling the %s substep returns without a grant",
    (action) => {
      const config = makeConfig({
        doublePressToConfirm: false,
        widthLabel: "Read and write",
        sessionScope: { subagentLabel: "Child", servingSessionLabel: "All" },
      });
      const opened = reducePrompt(config, initialPromptState(config), {
        type: "hotkey",
        action,
      });
      assertRender(opened);
      const canceled = reducePrompt(config, opened.state, { type: "cancel" });
      assertRender(canceled);
      expect(canceled.state.step).toBe("decision");
      expect(canceled.state.grantWidth).toBe("proven");
      expect(reducePrompt(config, canceled.state, { type: "cancel" })).toEqual({
        kind: "decision",
        decision: { approved: false, state: "denied" },
      });
    },
  );

  it.each([false, true])(
    "preserves family width through the forwarded scope step (serving=%s)",
    (serving) => {
      const config = makeConfig({
        doublePressToConfirm: false,
        widthLabel: "Read and write",
        sessionScope: { subagentLabel: "Child", servingSessionLabel: "All" },
      });
      const opened = reducePrompt(config, initialPromptState(config), {
        type: "hotkey",
        action: "approve",
      });
      assertRender(opened);
      expect(opened.state.scopeServing).toBe(false);
      const moved = reducePrompt(config, opened.state, {
        type: "nav",
        direction: serving ? "down" : "up",
      });
      assertRender(moved);
      expect(reducePrompt(config, moved.state, { type: "confirm" })).toEqual({
        kind: "decision",
        decision: {
          approved: true,
          state: serving
            ? "approved_for_serving_session"
            : "approved_for_session",
          sessionGrantWidth: "family",
        },
      });
    },
  );
});
