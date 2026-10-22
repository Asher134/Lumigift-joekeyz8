import { fireEvent, render, screen } from "@testing-library/react";
import { GiftFlowErrorBoundary } from "../GiftFlowErrorBoundary";

jest.mock("@sentry/nextjs", () => ({
  withScope: (callback: (_scope: { setTag: jest.Mock; setExtra: jest.Mock }) => void) =>
    callback({ setTag: jest.fn(), setExtra: jest.fn() }),
  captureException: jest.fn(),
}));

function BrokenGiftFlow() {
  throw new Error("Gift form render failed");
}

describe("GiftFlowErrorBoundary", () => {
  it("shows a recovery action and reports render errors to Sentry", () => {
    const consoleError = jest.spyOn(console, "error").mockImplementation(() => {});

    render(
      <GiftFlowErrorBoundary>
        <BrokenGiftFlow />
      </GiftFlowErrorBoundary>
    );

    expect(screen.getByRole("alert")).toHaveTextContent("couldn't load");
    fireEvent.click(screen.getByRole("button", { name: /try again/i }));
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(require("@sentry/nextjs").captureException).toHaveBeenCalledWith(
      expect.objectContaining({ message: "Gift form render failed" })
    );

    consoleError.mockRestore();
  });
});
