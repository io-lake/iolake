import { describe, it, expect } from "vitest";
import { recipientProfile } from "./deltaSharing";

describe("recipientProfile", () => {
  const origin = "https://lake.example.com";

  it("points the endpoint at the /delta-sharing/v1 base the gateway serves", () => {
    const p = recipientProfile(origin, "tok-123");
    expect(p.endpoint).toBe("https://lake.example.com/delta-sharing/v1");
    expect(p.endpoint.endsWith("/delta-sharing")).toBe(false);
  });

  it("resolves the protocol paths a delta-sharing client requests", () => {
    const { endpoint } = recipientProfile(origin, "tok-123");
    expect(new URL(`${endpoint}/shares`).pathname).toBe("/delta-sharing/v1/shares");
    expect(new URL(`${endpoint}/shares/s/all-tables`).pathname).toBe(
      "/delta-sharing/v1/shares/s/all-tables",
    );
  });

  it("carries the version and token through unchanged", () => {
    const p = recipientProfile(origin, "tok-abc");
    expect(p.shareCredentialsVersion).toBe(1);
    expect(p.bearerToken).toBe("tok-abc");
  });
});
