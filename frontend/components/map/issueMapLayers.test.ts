import { describe, expect, it } from "vitest";
import { groupIssueMarkers } from "./issueMapLayers";

describe("groupIssueMarkers", () => {
  it("groups exact and near-overlapping markers into one clickable group", () => {
    const groups = groupIssueMarkers([
      { id: "a", lat: 33.370001, lng: -81.965001, severity: "high", status: "pending" },
      { id: "b", lat: 33.370002, lng: -81.965002, severity: "medium", status: "approved" },
      { id: "c", lat: 33.3715, lng: -81.9675, severity: "low", status: "approved" },
    ]);

    expect(groups).toHaveLength(2);
    expect(groups[0]).toMatchObject({
      id: "a",
      count: 2,
      issueIds: ["a", "b"],
      severity: "high",
      status: "pending",
    });
    expect(groups[1]).toMatchObject({ id: "c", count: 1, issueIds: ["c"] });
  });
});
