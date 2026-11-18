import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getToken, setToken } from "@/lib/auth";
import { routes } from "@/routes";

const future = new Date(Date.now() + 60_000).toISOString();

function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(<RouterProvider router={router} />);
  return router;
}

function nav() {
  return screen.queryByRole("navigation", { name: "Main" });
}

describe("routes", () => {
  beforeEach(() => {
    setToken("tok", future);
  });

  afterEach(() => {
    localStorage.clear();
  });

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
    localStorage.clear();
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

describe("route guard", () => {
  afterEach(() => {
    localStorage.clear();
  });

  it.each(["/", "/library", "/does-not-exist"])("sends %s to /login without a token", (path) => {
    const router = renderAt(path);
    expect(router.state.location.pathname).toBe("/login");
    expect(screen.getByRole("heading", { name: "Login" })).toBeInTheDocument();
    expect(nav()).not.toBeInTheDocument();
  });

  it("sends / to /login when the stored token has expired", () => {
    setToken("tok", new Date(Date.now() - 1000).toISOString());
    const router = renderAt("/");
    expect(router.state.location.pathname).toBe("/login");
  });

  it("logout clears the token and goes to /login", async () => {
    setToken("tok", future);
    const user = userEvent.setup();
    const router = renderAt("/library");
    await user.click(screen.getByRole("button", { name: "Logout" }));
    expect(getToken()).toBeNull();
    expect(router.state.location.pathname).toBe("/login");

    await act(() => router.navigate("/library"));
    await waitFor(() => expect(router.state.location.pathname).toBe("/login"));
    expect(screen.getByRole("heading", { name: "Login" })).toBeInTheDocument();
  });
});
