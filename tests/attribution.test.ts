import { describe, expect, it } from "vitest";
import { campaignUrl, parseTouch } from "../src/analytics/attribution";

describe("campaign attribution (D-065)", () => {
  it("parses utm fields and ignores visits without a source", () => {
    expect(parseTouch("?room=ABC234")).toBeNull();
    expect(parseTouch("?utm_source=everytime&utm_medium=post&utm_campaign=launch&utm_content=a", 5)).toEqual({ source: "everytime", medium: "post", campaign: "launch", content: "a", at: 5 });
    expect(parseTouch("?utm_source=kakao", 1)).toEqual({ source: "kakao", medium: "(none)", campaign: "(none)", at: 1 });
  });
  it("drops markup and limits length (no free text is stored)", () => {
    expect(parseTouch("?utm_source=" + encodeURIComponent("<script>x</script>"))?.source).toBe("scriptxscript");
    expect(parseTouch("?utm_source=" + "a".repeat(200))?.source.length).toBe(80);
  });
  it("builds invite links that keep the room code next to the campaign", () => {
    const url = new URL(campaignUrl("https://oyueo-mm.github.io/YachtLab/", { source: "discord", medium: "invite", campaign: "friday", room: "abc234" }));
    expect(url.searchParams.get("room")).toBe("ABC234");
    expect(url.searchParams.get("utm_source")).toBe("discord");
    expect(url.pathname).toBe("/YachtLab/");
  });
});
