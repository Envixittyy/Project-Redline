import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Callout } from "./callout";

describe("Callout Primitive", () => {
  it("renders with default info variant and status role", () => {
    const html = renderToStaticMarkup(<Callout>This is an informative notice.</Callout>);
    expect(html).toContain("data-variant=\"info\"");
    expect(html).toContain("role=\"status\"");
    expect(html).toContain("This is an informative notice.");
  });

  it("renders with error variant and alert role", () => {
    const html = renderToStaticMarkup(
      <Callout variant="error" title="Connection error">
        Failed to connect to provider.
      </Callout>
    );
    expect(html).toContain("data-variant=\"error\"");
    expect(html).toContain("role=\"alert\"");
    expect(html).toContain("Connection error");
    expect(html).toContain("Failed to connect to provider.");
  });

  it("renders warning, success, and neutral variants", () => {
    const warning = renderToStaticMarkup(
      <Callout variant="warning" title="Warning note">Take care</Callout>
    );
    expect(warning).toContain("data-variant=\"warning\"");
    expect(warning).toContain("Warning note");

    const success = renderToStaticMarkup(
      <Callout variant="success">Saved successfully</Callout>
    );
    expect(success).toContain("data-variant=\"success\"");
    expect(success).toContain("Saved successfully");

    const neutral = renderToStaticMarkup(
      <Callout variant="neutral">Neutral observation</Callout>
    );
    expect(neutral).toContain("data-variant=\"neutral\"");
  });

  it("renders optional action", () => {
    const html = renderToStaticMarkup(
      <Callout action={<button type="button">Retry</button>}>
        Something went wrong
      </Callout>
    );
    expect(html).toContain("<button");
    expect(html).toContain("Retry</button>");
  });
});
