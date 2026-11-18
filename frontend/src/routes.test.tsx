import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it } from "vitest";
import { routes } from "@/routes";

function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(<RouterProvider router={router} />);
  return router;
}

function nav() {
  return screen.queryByRole("navigation", { name: "Main" });
}

describe("routes", () => {
  it("renders the nav with Ask and Library on /", () => {
    renderAt("/");
    expect(screen.getByRole("link", { name: "Ask" })).toHaveAttribute("href", "/");
    expect(screen.getByRole("link", { name: "Library" })).toHaveAttribute("href", "/library");
    expect(screen.getByRole("heading", { name: "Ask" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Ask" })).toHaveAttribute("aria-current", "page");
  });

  it("navigates between Ask and Library from the nav", async () => {
    const user = userEvent.setup();
    const router = renderAt("/");
    await user.click(screen.getByRole("link", { name: "Library" }));
    expect(router.state.location.pathname).toBe("/library");
    expect(screen.getByRole("heading", { name: "Library" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Library" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Ask" })).not.toHaveAttribute("aria-current");

    await user.click(screen.getByRole("link", { name: "Ask" }));
    expect(router.state.location.pathname).toBe("/");
  });

  it("renders /login without the nav", () => {
    renderAt("/login");
    expect(screen.getByRole("heading", { name: "Login" })).toBeInTheDocument();
    expect(nav()).not.toBeInTheDocument();
  });

  it("redirects an unknown route to /", () => {
    const router = renderAt("/does-not-exist");
    expect(router.state.location.pathname).toBe("/");
    expect(nav()).toBeInTheDocument();
  });
});
