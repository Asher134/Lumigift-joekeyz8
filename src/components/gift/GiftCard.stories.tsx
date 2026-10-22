import type { Meta, StoryObj } from "@storybook/react";
import { GiftCard } from "./GiftCard";
import type { Gift } from "@/types";

const meta: Meta<typeof GiftCard> = {
  title: "Gift/GiftCard",
  component: GiftCard,
  tags: ["autodocs"],
  argTypes: {
    perspective: {
      control: "select",
      options: ["sender", "recipient"],
      description: "Whether the viewer is the sender or recipient",
    },
  },
};

export default meta;
type Story = StoryObj<typeof GiftCard>;

const baseGift: Gift = {
  id: "gift-123",
  senderId: "user-1",
  recipientName: "Amara",
  recipientPhoneHash: "hash(…)",
  amountNgn: 5000,
  amountUsdc: "3.0000000",
  unlockAt: new Date(Date.now() + 86400000).toISOString(),
  status: "locked",
  message: "Happy birthday! Hope you love it 🎁",
  stellarTxHash: undefined,
  claimTxHash: undefined,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  refundStatus: undefined,
};

export const SenderLocked: Story = {
  args: {
    gift: baseGift,
    perspective: "sender",
  },
};

export const RecipientLocked: Story = {
  args: {
    gift: baseGift,
    perspective: "recipient",
    recipientStellarKey: "GCA…",
  },
};

export const SenderClaimed: Story = {
  args: {
    gift: { ...baseGift, status: "claimed" },
    perspective: "sender",
  },
};

export const RecipientUnlocked: Story = {
  args: {
    gift: { ...baseGift, status: "unlocked" },
    perspective: "recipient",
    recipientStellarKey: "GCA…",
  },
};
