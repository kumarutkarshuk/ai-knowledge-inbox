import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getToken, setToken } from "@/lib/auth";
import { routes } from "@/routes";

const future = new Date(Date.now() + 60_000).toISOString();

const fetchMock = vi.fn<typeof fetch>();

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status });
}

function renderLogin() {
  const router = createMemoryRouter(routes, { initialEntries: ["/login"] });
  render(<RouterProvider router={router} />);
  return router;
}

async function submit(password: string) {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("Password"), password);
  await user.click(screen.getByRole("button", { name: "Login" }));
}

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  localStorage.clear();
  fetchMock.mockReset();
  vi.unstubAllGlobals();
});

describe("LoginPage", () => {
  it("stores the token and goes to / on the right password", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, { token: "tok", expiresAt: "2099-11-25T00:00:00.000Z" }),
    );
    const router = renderLogin();
    await submit("secret");
    expect(
      await screen.findByRole("heading", { name: "What do you want to know?" }),
    ).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/");
    expect(getToken()).toBe("tok");
    expect(JSON.parse(localStorage.getItem("session") ?? "")).toEqual({
      token: "tok",
      expiresAt: "2099-11-25T00:00:00.000Z",
    });
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("http://localhost:3000/login");
    expect(init?.method).toBe("POST");
    expect(init?.body).toBe(JSON.stringify({ password: "secret" }));
  });

  it("shows an error on 401 and stays on /login", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(401, { error: { code: "UNAUTHORIZED", message: "Wrong password" } }),
    );
    const router = renderLogin();
    await submit("wrong");
    expect(await screen.findByRole("alert")).toHaveTextContent("Wrong password");
    expect(router.state.location.pathname).toBe("/login");
    expect(getToken()).toBeNull();
  });

  it("shows a wait message on 429", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(429, { error: { code: "TOO_MANY_REQUESTS", message: "Too many" } }),
    );
    renderLogin();
    await submit("wrong");
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Too many attempts. Try again in a minute.",
    );
  });

  it("shows a message when the server cannot be reached", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    renderLogin();
    await submit("secret");
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not reach the server");
  });

  it("disables the button while logging in", async () => {
    fetchMock.mockReturnValue(new Promise(() => {}));
    renderLogin();
    await submit("secret");
    expect(screen.getByRole("button", { name: "Logging in..." })).toBeDisabled();
  });

  it("goes to / when already logged in", () => {
    setToken("tok", future);
    const router = renderLogin();
    expect(router.state.location.pathname).toBe("/");
  });
});
