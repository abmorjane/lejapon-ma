import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { validateBuildEnvironment } from "./validate-build-env.mjs";

const valid = {
  VITE_SUPABASE_PROJECT_ID: "nkovgpzspprmmhorwaxl",
  VITE_SUPABASE_URL: "https://nkovgpzspprmmhorwaxl.supabase.co",
  VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_AbC123ZyX987KjH654MnP321",
};

describe("production build environment", () => {
  it("accepts the intended project and a non-placeholder public key", () => {
    assert.deepEqual(validateBuildEnvironment(valid), []);
  });

  it("fails closed when required values are absent", () => {
    assert.equal(validateBuildEnvironment({}).length, 3);
    for (const name of [
      "VITE_SUPABASE_PROJECT_ID",
      "VITE_SUPABASE_URL",
      "VITE_SUPABASE_PUBLISHABLE_KEY",
    ]) {
      assert.equal(validateBuildEnvironment({ ...valid, [name]: undefined }).length, 1, name);
    }
  });

  it("refuses other projects and placeholder values", () => {
    assert.equal(validateBuildEnvironment({
      VITE_SUPABASE_PROJECT_ID: "another-project",
      VITE_SUPABASE_URL: "https://another-project.supabase.co",
      VITE_SUPABASE_PUBLISHABLE_KEY: "your-publishable-key",
    }).length, 3);
    assert.equal(validateBuildEnvironment({ ...valid, VITE_SUPABASE_PROJECT_ID: "other-ref" }).length, 1);
    assert.equal(validateBuildEnvironment({ ...valid, VITE_SUPABASE_URL: "https://other-ref.supabase.co" }).length, 1);
    assert.equal(validateBuildEnvironment({ ...valid, VITE_SUPABASE_PUBLISHABLE_KEY: "your-publishable-key" }).length, 1);
  });

  it("refuses a test key even with the correct project URL", () => {
    assert.equal(validateBuildEnvironment({ ...valid, VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test_key" }).length, 1);
  });

  it("never accepts a server secret key", () => {
    assert.equal(validateBuildEnvironment({ ...valid, VITE_SUPABASE_PUBLISHABLE_KEY: "sb_secret_fixture" }).length, 1);
  });
});
