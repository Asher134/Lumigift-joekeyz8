import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react";
import type { GiftStatus } from "@/types";
import { ClaimButton } from "./ClaimButton";

const meta: Meta<typeof ClaimButton> = {
  title: "Gift/ClaimButton",
  component: ClaimButton,
  tags: ["autodocs"],
  argTypes: {
    giftId: { control: "text" },
    recipientStellarKey: { control: "text" },
  },
};

export default meta;
type Story = StoryObj<typeof ClaimButton>;

export const Idle: Story = {
  args: {
    giftId: "gift-123",
    recipientStellarKey: "GCAXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
    onStatusChange: () => {},
  },
};

export const Interactive: Story = {
  render: (args) => {
    const [status, setStatus] = useState<GiftStatus>("unlocked");
    return (
      <div style={{ maxWidth: "300px" }}>
        <p>Current status: <strong>{status}</strong></p>
        <ClaimButton
          giftId={args.giftId ?? "gift-123"}
          recipientStellarKey={args.recipientStellarKey ?? "GCA…"}
          onStatusChange={setStatus}
        />
      </div>
    );
  },
  args: {
    giftId: "gift-123",
    recipientStellarKey: "GCAXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
  },
};
