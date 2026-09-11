import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("server-only", () => ({}));
vi.mock("./auth-actions", () => ({
  signInAction: vi.fn(),
  signOutAction: vi.fn(),
}));

import { SignInForm } from "./sign-in-form";
import { SignOutControl } from "./sign-out-control";

describe("Auth UI Primitives", () => {
  it("renders SignInForm with inputs and S7 submit button", () => {
    const html = renderToStaticMarkup(<SignInForm />);
    expect(html).toContain("Email");
    expect(html).toContain("Password");
    expect(html).toContain("Sign in");
    expect(html).toContain('id="signin-email"');
    expect(html).toContain('id="signin-password"');
  });

  it("renders SignOutControl with S7 secondary button", () => {
    const html = renderToStaticMarkup(<SignOutControl />);
    expect(html).toContain("Sign out of this device");
  });
});
