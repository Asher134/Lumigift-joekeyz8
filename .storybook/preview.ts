import type { Preview } from "@storybook/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// Import the project's vanilla CSS so stories render with the design-system tokens.
import "../src/styles/tokens.css";
import "../src/styles/components.css";

const queryClient = new QueryClient();

const preview: Preview = {
  parameters: {
    controls: {
      expanded: true,
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
    backgrounds: {
      default: "dark",
      values: [
        { name: "dark", value: "#0d0d14" },
        { name: "light", value: "#f5f5fa" },
      ],
    },
    layout: "centered",
  },
  decorators: [
    (Story) => (
      <QueryClientProvider client={queryClient}>
        <Story />
      </QueryClientProvider>
    ),
  ],
  tags: ["autodocs"],
};

export default preview;
