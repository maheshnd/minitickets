import { describe, expect, it } from "vitest";
import { NO_TAG_YET, chooseImageTags } from "./image-tag";

const none = { apiImageTag: undefined, webImageTag: undefined, migrationImageTag: undefined };

describe("chooseImageTags", () => {
  // 1. The normal case: CD wrote a tag to SSM, nothing in config. Everything runs that tag.
  it("uses the SSM tag for api, web and the migration", () => {
    expect(chooseImageTags({ ...none, deployedTag: "1a2b3c4" })).toEqual({
      api: "1a2b3c4",
      web: "1a2b3c4",
      migration: "1a2b3c4",
    });
  });

  // 2. CD phase A: the services keep the current tag, only the migration gets the new one.
  it("migrationImageTag changes only the migration", () => {
    expect(chooseImageTags({ ...none, deployedTag: "1a2b3c4", migrationImageTag: "9f8e7d6" })).toEqual({
      api: "1a2b3c4",
      web: "1a2b3c4",
      migration: "9f8e7d6",
    });
  });

  // 3. Emergency / manual override: config beats SSM, per service. The migration follows the api.
  it("apiImageTag / webImageTag override SSM, each on its own", () => {
    expect(chooseImageTags({ ...none, deployedTag: "1a2b3c4", apiImageTag: "aaaaaaa" })).toEqual({
      api: "aaaaaaa",
      web: "1a2b3c4",
      migration: "aaaaaaa",
    });
    expect(chooseImageTags({ ...none, deployedTag: undefined, apiImageTag: "aaaaaaa", webImageTag: "bbbbbbb" }))
      .toEqual({ api: "aaaaaaa", web: "bbbbbbb", migration: "aaaaaaa" });
  });

  // 4. Nothing deployed yet (no parameter, or still the placeholder) and no override: a clear error.
  it("fails clearly when no tag exists anywhere", () => {
    for (const deployedTag of [undefined, NO_TAG_YET]) {
      expect(() => chooseImageTags({ ...none, deployedTag })).toThrow(/no image tag has been deployed yet/);
    }
    // Only one service overridden is still not enough: web has no tag.
    expect(() => chooseImageTags({ ...none, deployedTag: NO_TAG_YET, apiImageTag: "aaaaaaa" })).toThrow(
      /no image tag/,
    );
  });

  // 5. A tag must look like a git SHA: "latest", upper case, too short or a typo fail in the preview.
  it("refuses tags that are not git SHAs", () => {
    for (const bad of ["latest", "1A2B3C4", "1a2b3c", "1a2b3c4 ", "deployed-1a2b3c4"]) {
      expect(() => chooseImageTags({ ...none, deployedTag: bad }), bad).toThrow(/not a git SHA/);
      expect(() => chooseImageTags({ ...none, deployedTag: "1a2b3c4", migrationImageTag: bad }), bad).toThrow(
        /migration image tag/,
      );
    }
  });
});
