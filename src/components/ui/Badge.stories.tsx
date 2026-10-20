import type { Meta, StoryObj } from "@storybook/react";
import { Badge } from "./Badge";

const meta: Meta<typeof Badge> = {
  title: "UI/Badge",
  component: Badge,
  tags: ["autodocs"],
  argTypes: {
    variant: {
      control: "select",
      options: ["primary", "secondary", "success", "warning", "error", "info"],
      description: "Badge color variant",
    },
    size: {
      control: "select",
      options: ["sm", "md", "lg"],
      description: "Badge size",
    },
  },
};

export default meta;
type Story = StoryObj<typeof Badge>;

export const Primary: Story = {
  args: { children: "Primary", variant: "primary" },
};

export const Secondary: Story = {
  args: { children: "Secondary", variant: "secondary" },
};

export const Success: Story = {
  args: { children: "Success", variant: "success" },
};

export const Warning: Story = {
  args: { children: "Warning", variant: "warning" },
};

export const Error: Story = {
  args: { children: "Error", variant: "error" },
};

export const Info: Story = {
  args: { children: "Info", variant: "info" },
};

export const Small: Story = {
  args: { children: "Small badge", size: "sm" },
};

export const Large: Story = {
  args: { children: "Large badge", size: "lg" },
};
