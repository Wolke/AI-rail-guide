import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { App } from "./App";

describe("RailTalk web demo", () => {
  it("shows the route and starts a journey", async () => {
    const user = userEvent.setup();
    render(<App />);

    expect(screen.getByRole("heading", { name: /瑞芳/ })).toBeInTheDocument();
    expect(screen.getByText("模擬導覽 · Web Speech")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "開始旅程" }));
    expect(screen.getByText("列車行進中")).toBeInTheDocument();
    expect(screen.getByText(/下一站 猴硐/)).toBeInTheDocument();
  });

  it("offers fallback questions when speech recognition is unavailable", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.pointer([{ keys: "[MouseLeft>]", target: screen.getByRole("button", { name: "問導遊一個問題" }) }]);
    expect(screen.getByRole("dialog", { name: "選擇示範問題" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: questions[0] }));
    expect(screen.getByText(questions[0])).toBeInTheDocument();
  });

  it("supports pause, mute and fast demo controls", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: "開始旅程" }));
    await user.click(screen.getByRole("button", { name: "暫停導覽" }));
    expect(screen.getByText("導覽已暫停")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /音訊 開/ }));
    expect(screen.getByRole("button", { name: /音訊 關/ })).toHaveAttribute("aria-pressed", "true");
    await user.click(screen.getByRole("button", { name: "快速展示" }));
    expect(screen.getByRole("button", { name: "快速展示" })).toHaveAttribute("aria-pressed", "true");
  });

  it("advances to the next station in fast mode", async () => {
    vi.useFakeTimers();
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "快速展示" }));
    fireEvent.click(screen.getByRole("button", { name: "開始旅程" }));
    await vi.advanceTimersByTimeAsync(8_100);
    expect(screen.getByRole("heading", { name: /猴硐/ })).toBeInTheDocument();
    vi.useRealTimers();
  });
});

const questions = ["請問這一站為什麼值得停留？"];
