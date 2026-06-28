"use client";

// Open the Mise Copilot from anywhere and (optionally) ask it something. The Copilot
// component listens for this event, opens its panel, and sends the prompt.
export function askMise(prompt?: string) {
  window.dispatchEvent(new CustomEvent("mise:ask", { detail: { prompt } }));
}
