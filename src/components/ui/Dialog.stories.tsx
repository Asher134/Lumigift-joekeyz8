import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react";
import { Dialog } from "./Dialog";
import { Button } from "./Button";

const meta: Meta<typeof Dialog> = {
  title: "UI/Dialog",
  component: Dialog,
  tags: ["autodocs"],
  argTypes: {
    open: { control: "boolean" },
    title: { control: "text" },
  },
};

export default meta;
type Story = StoryObj<typeof Dialog>;

export const Default: Story = {
  render: (args) => {
    const [open, setOpen] = useState(args.open ?? false);
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: "1rem", alignItems: "center" }}>
        <Button onClick={() => setOpen(true)}>Open dialog</Button>
        <Dialog
          open={open}
          onClose={() => setOpen(false)}
          title={args.title ?? "Dialog title"}
        >
          <p>This is the dialog content. Press Escape or click the backdrop to close.</p>
          <Button onClick={() => setOpen(false)} variant="secondary">
            Close
          </Button>
        </Dialog>
      </div>
    );
  },
  args: {
    open: false,
    title: "Are you sure?",
  },
};
