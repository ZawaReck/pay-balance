import { describe, expect, it } from "vitest";
import { numericFontSize } from "../src/domain/formatting";

describe("金額の文字サイズ", () => {
  it("5桁までは基準サイズを維持する", () => {
    expect(numericFontSize(12345, 28, 16)).toBe("28px");
  });

  it("6桁以降は桁数に応じて縮小する", () => {
    expect(numericFontSize(123456, 28, 16)).toBe("26px");
    expect(numericFontSize(12345678, 28, 16)).toBe("22px");
  });

  it("指定した最小サイズより小さくしない", () => {
    expect(numericFontSize("123456789012345", 20, 13)).toBe("13px");
  });
});
