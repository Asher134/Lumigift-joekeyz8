import type { Meta, StoryObj } from "@storybook/react";
import { Button } from "./Button";

const meta: Meta<typeof Button> = {
  title: "UI/Button",
  component: Button,
  tags: ["autodocs"],
  argTypes: {
    variant: {
      control: "select",
      options: ["primary", "secondary", "ghost", "danger"],
      description: "Button style variant",
    },
    size: {
      control: "select",
      options: ["sm", "md", "lg"],
      description: "Button size",
    },
    loading: {
      control: "boolean",
      description: "Show a loading spinner and disable the button",
    },
    fullWidth: {
      control: "boolean",
      description: "Make the button fill its container width",
    },
  },
};

export default meta;
type Story = StoryObj<typeof Button>;

export const Primary: Story = {
  args: {
    children: "Primary action",
    variant: "primary",
  },
};

export const Secondary: Story = {
  args: {
    children: "Secondary action",
    variant: "secondary",
  },
};

export const Ghost: Story = {
  args: {
    children: "Ghost action",
    variant: "ghost",
  },
};

export const Danger: Story = {
  args: {
    children: "Delete gift",
    variant: "danger",
  },
};

export const Loading: Story = {
  args: {
    children: "Processing…",
    loading: true,
  },
};

export const Disabled: Story = {
  args: {
    children: "Disabled",
    disabled: true,
  },
};

export const FullWidth: Story = {
  args: {
    children: "Full width button",
    fullWidth: true,
  },
};
