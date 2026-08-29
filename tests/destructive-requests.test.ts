import { describe, expect, it } from "vitest";
import { canApproveRequest, isDestructiveKind } from "../src/server/destructive-requests";

describe("二人承認が必要な操作", () => {
  it("対応する3種類の申請だけを受け付ける", () => {
    expect(isDestructiveKind("settle")).toBe(true);
    expect(isDestructiveKind("dissolve_pair")).toBe(true);
    expect(isDestructiveKind("delete_account")).toBe(true);
    expect(isDestructiveKind("reset_everything")).toBe(false);
    expect(isDestructiveKind(null)).toBe(false);
  });

  it("申請者本人による承認を拒否する", () => {
    expect(canApproveRequest("partner", "requester")).toBe(true);
    expect(canApproveRequest("requester", "requester")).toBe(false);
  });
});
