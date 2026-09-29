import { describe, expect, it, vi } from "vitest";
import {
  createDeniedPermissionDecision,
  isPermissionDecisionState,
  normalizePermissionDenialReason,
  type PermissionDecisionUi,
  requestPermissionDecisionFromUi,
} from "#src/authority/permission-dialog";

describe("isPermissionDecisionState", () => {
  it("accepts approved", () => {
    expect(isPermissionDecisionState("approved")).toBe(true);
  });

  it("accepts denied", () => {
    expect(isPermissionDecisionState("denied")).toBe(true);
  });

  it("accepts denied_with_reason", () => {
    expect(isPermissionDecisionState("denied_with_reason")).toBe(true);
  });

  it("accepts approved_for_session", () => {
    expect(isPermissionDecisionState("approved_for_session")).toBe(true);
  });

  it("accepts approved_for_serving_session", () => {
    expect(isPermissionDecisionState("approved_for_serving_session")).toBe(
      true,
    );
  });

  it("rejects unknown strings", () => {
    expect(isPermissionDecisionState("unknown")).toBe(false);
  });

  it("rejects non-strings", () => {
    expect(isPermissionDecisionState(42)).toBe(false);
    expect(isPermissionDecisionState(null)).toBe(false);
  });
});

describe("requestPermissionDecisionFromUi", () => {
  const sessionWidth = {
    label: 'Yes, allow reads and writes to "/tmp/*" for this session',
  };
  const sessionScope = {
    subagentLabel: "This subagent only",
    servingSessionLabel: "The whole session",
  };

  it("offers only Yes and No, with the effective grant visible separately", async () => {
    const ui = { select: vi.fn().mockResolvedValue("Yes"), input: vi.fn() };
    const result = await requestPermissionDecisionFromUi(
      ui,
      "Title",
      "Message",
      {
        sessionLabel: 'Yes, allow writes to "/tmp/*" for this session',
        sessionWidth,
      },
    );
    expect(ui.select).toHaveBeenCalledExactlyOnceWith(
      `Title\nMessage\n\n${sessionWidth.label}`,
      ["Yes", "No"],
    );
    expect(result).toEqual({
      approved: true,
      state: "approved_for_session",
      sessionGrantWidth: "family",
    });
    expect(ui.input).not.toHaveBeenCalled();
  });

  it("approves the existing session pattern when no wider grant is available", async () => {
    const ui = { select: vi.fn().mockResolvedValue("Yes"), input: vi.fn() };
    const result = await requestPermissionDecisionFromUi(
      ui,
      "Title",
      "Message",
      {
        sessionLabel: 'Yes, allow "git status *" for this session',
      },
    );
    expect(result).toEqual({ approved: true, state: "approved_for_session" });
    expect(ui.select).toHaveBeenCalledExactlyOnceWith(
      'Title\nMessage\n\nYes, allow "git status *" for this session',
      ["Yes", "No"],
    );
  });

  it("opens the reason input on No and returns the trimmed reason", async () => {
    const ui = {
      select: vi.fn().mockResolvedValue("No"),
      input: vi.fn().mockResolvedValue("  not now  "),
    };
    expect(
      await requestPermissionDecisionFromUi(ui, "Title", "Message"),
    ).toEqual({
      approved: false,
      state: "denied_with_reason",
      denialReason: "not now",
    });
    expect(ui.input).toHaveBeenCalledExactlyOnceWith(
      "Title\nShare why this request was denied.",
      "Reason shown back to the agent",
    );
  });

  it.each([undefined, "", "  "])(
    "denies safely when the reason is absent (%s)",
    async (reason) => {
      const ui = {
        select: vi.fn().mockResolvedValue("No"),
        input: vi.fn().mockResolvedValue(reason),
      };
      expect(
        await requestPermissionDecisionFromUi(ui, "Title", "Message"),
      ).toEqual({ approved: false, state: "denied" });
    },
  );

  it.each([undefined, "unexpected"])(
    "does not approve a canceled or unknown decision (%s)",
    async (choice) => {
      const ui = { select: vi.fn().mockResolvedValue(choice), input: vi.fn() };
      expect(
        await requestPermissionDecisionFromUi(ui, "Title", "Message"),
      ).toEqual({ approved: false, state: "denied" });
      expect(ui.input).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["This subagent only", "approved_for_session"],
    ["The whole session", "approved_for_serving_session"],
  ])(
    "preserves the explicitly selected forwarded scope: %s",
    async (scope, state) => {
      const ui = {
        select: vi
          .fn()
          .mockResolvedValueOnce("Yes")
          .mockResolvedValueOnce(scope),
        input: vi.fn(),
      };
      expect(
        await requestPermissionDecisionFromUi(ui, "Title", "Message", {
          sessionScope,
          sessionWidth,
        }),
      ).toEqual({
        approved: true,
        state,
        sessionGrantWidth: "family",
      });
      expect(ui.select).toHaveBeenNthCalledWith(
        2,
        "Title\nApply this session grant to:",
        ["This subagent only", "The whole session"],
      );
    },
  );

  it.each([undefined, "unexpected"])(
    "denies a canceled or unknown forwarded scope (%s)",
    async (scope) => {
      const ui = {
        select: vi
          .fn()
          .mockResolvedValueOnce("Yes")
          .mockResolvedValueOnce(scope),
        input: vi.fn(),
      };
      expect(
        await requestPermissionDecisionFromUi(ui, "Title", "Message", {
          sessionScope,
          sessionWidth,
        }),
      ).toEqual({ approved: false, state: "denied" });
    },
  );

  it("propagates unexpected UI failures", async () => {
    const ui: PermissionDecisionUi = {
      select: vi.fn().mockRejectedValue(new Error("UI unavailable")),
      input: vi.fn(),
    };
    await expect(
      requestPermissionDecisionFromUi(ui, "Title", "Message"),
    ).rejects.toThrow("UI unavailable");
  });
});

describe("normalizePermissionDenialReason", () => {
  it("returns trimmed string for non-empty input", () => {
    expect(normalizePermissionDenialReason("  reason  ")).toBe("reason");
  });

  it("returns undefined for empty string", () => {
    expect(normalizePermissionDenialReason("")).toBeUndefined();
  });

  it("returns undefined for non-string", () => {
    expect(normalizePermissionDenialReason(42)).toBeUndefined();
  });
});

describe("createDeniedPermissionDecision", () => {
  it("returns denied_with_reason when reason provided", () => {
    expect(createDeniedPermissionDecision("nope")).toEqual({
      approved: false,
      state: "denied_with_reason",
      denialReason: "nope",
    });
  });

  it("returns denied when no reason", () => {
    expect(createDeniedPermissionDecision()).toEqual({
      approved: false,
      state: "denied",
    });
  });
});
