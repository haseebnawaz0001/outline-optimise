import { Node } from "prosemirror-model";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DocumentEvent } from "@server/types";

vi.mock("../index", () => ({
  globalEventQueue: vi.fn(),
  processorEventQueue: vi.fn(),
  websocketQueue: vi.fn(),
  taskQueue: vi.fn(),
}));

const { serialize } = vi.hoisted(() => ({
  serialize: vi.fn(() => "serialized-markdown"),
}));

vi.mock("@server/editor", async () => {
  const { Schema } = await import("prosemirror-model");
  return {
    schema: new Schema({
      nodes: {
        doc: { content: "text*" },
        text: {},
      },
    }),
    serializer: { serialize },
  };
});

const { franc } = vi.hoisted(() => ({
  franc: vi.fn(() => "eng"),
}));
vi.mock("franc", () => ({ franc }));

vi.mock("iso-639-3", () => ({
  iso6393To1: { eng: "en" },
}));

const { textBetween } = vi.hoisted(() => ({
  textBetween: vi.fn(() => "plain text for detection"),
}));
vi.mock("@shared/editor/lib/textBetween", () => ({
  default: textBetween,
}));

const { findByPk } = vi.hoisted(() => ({
  findByPk: vi.fn(),
}));
vi.mock("@server/models", () => ({
  Document: { findByPk },
}));

describe("DocumentUpdateTextTask", () => {
  const event: DocumentEvent = {
    name: "documents.publish",
    documentId: "doc-id",
    collectionId: "collection-id",
    teamId: "team-id",
    actorId: "actor-id",
    ip: null,
  };

  let fakeDocument: {
    content: Record<string, unknown>;
    language?: string;
    save: ReturnType<typeof vi.fn>;
    text?: string;
  };

  const loadTask = async () => {
    // Queue tasks are eagerly loaded by server/test/setupMocks.ts before
    // file-level mocks are registered, so re-import to bind them.
    vi.resetModules();
    const { default: Task } = await import("./DocumentUpdateTextTask");
    return Task;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    fakeDocument = {
      content: {
        type: "doc",
        content: [{ type: "text", text: "The quick brown fox" }],
      },
      save: vi.fn().mockResolvedValue(undefined),
    };
    findByPk.mockResolvedValue(fakeDocument);
  });

  describe("#perform", () => {
    it("parses document content once and derives both outputs from the same node", async () => {
      const Task = await loadTask();
      const parsedNode = {
        content: { size: 42 },
      } as unknown as Node;
      const fromJSON = vi
        .spyOn(Node, "fromJSON")
        .mockImplementation(() => parsedNode);

      await new Task().perform(event);

      // Exactly one parse of the document content…
      expect(fromJSON).toHaveBeenCalledTimes(1);
      expect(fromJSON).toHaveBeenCalledWith(
        expect.anything(),
        fakeDocument.content
      );

      // …which feeds both the Markdown serialization…
      expect(serialize).toHaveBeenCalledTimes(1);
      expect(serialize).toHaveBeenCalledWith(parsedNode);

      // …and the plain text used for language detection.
      expect(textBetween).toHaveBeenCalledTimes(1);
      expect(textBetween).toHaveBeenCalledWith(parsedNode, 0, 42);

      fromJSON.mockRestore();
    });

    it("detects the document language from the plain text", async () => {
      const Task = await loadTask();

      await new Task().perform(event);

      expect(franc).toHaveBeenCalledTimes(1);
      expect(franc).toHaveBeenCalledWith("plain text for detection", {
        minLength: 50,
      });
      expect(fakeDocument.language).toBe("en");
    });

    it("saves the updated text silently", async () => {
      const Task = await loadTask();

      await new Task().perform(event);

      expect(fakeDocument.text).toBe("serialized-markdown");
      expect(fakeDocument.save).toHaveBeenCalledWith({ silent: true });
    });

    it("does nothing when the document is not found", async () => {
      const Task = await loadTask();
      findByPk.mockResolvedValue(null);

      await new Task().perform(event);

      expect(serialize).not.toHaveBeenCalled();
      expect(franc).not.toHaveBeenCalled();
    });
  });
});
