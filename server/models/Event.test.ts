import Event from "./Event";

describe("Event", () => {
  describe("stripForQueue", () => {
    it("strips oversized values from changes.attributes and changes.previous", () => {
      const event = Event.build({
        name: "documents.update",
        teamId: "4a70b1e0-9f2d-4b3a-9c6f-8f7a5d3e2b1c",
        changes: {
          attributes: {
            title: "A reasonable title",
            content: "x".repeat(9000),
          },
          previous: {
            title: "Another reasonable title",
            content: { text: "y".repeat(9000) },
          },
        },
      });

      const result = Event.stripForQueue(event);

      expect(result.changes).toEqual({
        attributes: {
          title: "A reasonable title",
          content: "[stripped]",
        },
        previous: {
          title: "Another reasonable title",
          content: {
            text: "[stripped]",
          },
        },
      });
    });

    it("leaves values under the limit byte-identical", () => {
      const attributes = { title: "Small", content: { text: "tiny" } };
      const previous = { title: "Old" };
      const event = Event.build({
        name: "documents.update",
        teamId: "4a70b1e0-9f2d-4b3a-9c6f-8f7a5d3e2b1c",
        changes: { attributes, previous },
      });

      const result = Event.stripForQueue(event);

      expect(result.changes).toEqual({ attributes, previous });
    });

    it("strips nested oversized entries while preserving siblings", () => {
      const event = Event.build({
        name: "documents.update",
        teamId: "4a70b1e0-9f2d-4b3a-9c6f-8f7a5d3e2b1c",
        changes: {
          attributes: {
            title: "Kept",
            nested: {
              list: ["a".repeat(9000)],
              scalar: 1,
            },
          },
        },
      });

      const result = Event.stripForQueue(event);

      expect(result.changes).toEqual({
        attributes: {
          title: "Kept",
          nested: {
            list: ["[stripped]"],
            scalar: 1,
          },
        },
      });
    });

    it("returns events without changes untouched", () => {
      const event = Event.build({
        name: "documents.create",
        teamId: "4a70b1e0-9f2d-4b3a-9c6f-8f7a5d3e2b1c",
      });

      expect(Event.stripForQueue(event)).toBe(event);
      expect(event.changes).toBeUndefined();
    });

    it("handles partial changes with only one side present", () => {
      const event = Event.build({
        name: "documents.update",
        teamId: "4a70b1e0-9f2d-4b3a-9c6f-8f7a5d3e2b1c",
        changes: {
          attributes: { title: "z".repeat(9000) },
        } as never,
      });

      const result = Event.stripForQueue(event);

      expect(result.changes).toEqual({
        attributes: { title: "[stripped]" },
        previous: undefined,
      });
    });
  });
});
