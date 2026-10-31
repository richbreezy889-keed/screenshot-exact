import { describe, expect, it } from "vitest";
import { attentionLabelKey, pluralKey } from "@/lib/plural";
import { dict } from "@/lib/i18n";
import type { AttentionKind } from "@/data/dashboard";

const kinds: AttentionKind[] = ["approveVideo", "verifyViews", "applicants"];

describe("pluralKey", () => {
  it("uses the singular only for exactly one", () => {
    expect(pluralKey("creatorFound", "creatorsFound", 1)).toBe("creatorFound");
  });

  it.each([0, 2, 5, 100, 220_600])("uses the plural for %i", (count) => {
    expect(pluralKey("creatorFound", "creatorsFound", count)).toBe("creatorsFound");
  });
});

describe("attention labels", () => {
  it("agrees with the count in English", () => {
    expect(dict[attentionLabelKey("approveVideo", 1)].en).toBe("video to approve");
    expect(dict[attentionLabelKey("approveVideo", 3)].en).toBe("videos to approve");
    expect(dict[attentionLabelKey("applicants", 1)].en).toBe("applicant waiting");
    expect(dict[attentionLabelKey("applicants", 2)].en).toBe("applicants waiting");
    expect(dict[attentionLabelKey("verifyViews", 1)].en).toBe("view to verify");
    expect(dict[attentionLabelKey("verifyViews", 55_150)].en).toBe("views to verify");
  });

  it("agrees with the count in Swahili", () => {
    expect(dict[attentionLabelKey("approveVideo", 1)].sw).toBe("video ya kuidhinisha");
    expect(dict[attentionLabelKey("approveVideo", 3)].sw).toBe("video za kuidhinisha");
    expect(dict[attentionLabelKey("applicants", 1)].sw).toBe("mwombaji anasubiri");
    expect(dict[attentionLabelKey("applicants", 2)].sw).toBe("waombaji wanasubiri");
    expect(dict[attentionLabelKey("verifyViews", 1)].sw).toBe("mtazamo wa kuthibitisha");
    expect(dict[attentionLabelKey("verifyViews", 55_150)].sw).toBe("mitazamo ya kuthibitisha");
  });

  it("has distinct, non-empty singular and plural text for every kind", () => {
    for (const kind of kinds) {
      const one = dict[attentionLabelKey(kind, 1)];
      const other = dict[attentionLabelKey(kind, 2)];
      expect(one.en, `${kind} en singular`).toBeTruthy();
      expect(other.en, `${kind} en plural`).toBeTruthy();
      expect(one.sw, `${kind} sw singular`).toBeTruthy();
      expect(other.sw, `${kind} sw plural`).toBeTruthy();
      expect(one.en).not.toBe(other.en);
      expect(one.sw).not.toBe(other.sw);
    }
  });
});
