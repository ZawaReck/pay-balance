import { describe, expect, it } from "vitest";
import {
  canDeleteAccountImmediately,
  isDisplayName,
  normalizeDisplayName,
  parseLeftOnLeft,
} from "../src/server/auth";

describe("表示名", () => {
  it("前後の空白を除いて保存する", () => {
    expect(normalizeDisplayName("  はなこ  ")).toBe("はなこ");
  });

  it("1〜24文字だけを受け付ける", () => {
    expect(isDisplayName("はなこ")).toBe(true);
    expect(isDisplayName("")).toBe(false);
    expect(isDisplayName("あ".repeat(25))).toBe(false);
  });

  it("絵文字を1文字として数える", () => {
    expect(isDisplayName("🌷".repeat(24))).toBe(true);
    expect(isDisplayName("🌷".repeat(25))).toBe(false);
  });

  it("ペア未所属の場合だけ即時削除できる", () => {
    expect(canDeleteAccountImmediately(null)).toBe(true);
    expect(canDeleteAccountImmediately("pair-id")).toBe(false);
  });

  it("左右の表示順には真偽値だけを受け付ける", () => {
    expect(parseLeftOnLeft(true)).toBe(true);
    expect(parseLeftOnLeft(false)).toBe(false);
    expect(parseLeftOnLeft("false")).toBeNull();
  });
});
