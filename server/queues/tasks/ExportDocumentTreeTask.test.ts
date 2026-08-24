import type { NavigationNode } from "@shared/types";
import { FileOperationFormat } from "@shared/types";
import ExportDocumentTreeTask from "./ExportDocumentTreeTask";

class TestExportDocumentTreeTask extends ExportDocumentTreeTask {
  protected exportCollections(): Promise<string> {
    return Promise.resolve("");
  }

  protected exportDocument(): Promise<string> {
    return Promise.resolve("");
  }
}

/**
 * Typed view over the private path-map builder, used to exercise collision
 * handling without a database.
 */
interface PathMapBuilder {
  addDocumentTreeToPathMap(
    map: Map<string, string>,
    nodes: NavigationNode[],
    root: string,
    format: FileOperationFormat
  ): void;
}

const node = (
  id: string,
  title: string,
  children: NavigationNode[] = []
): NavigationNode => ({
  id,
  title,
  url: `/doc/${title.toLowerCase()}-${id}`,
  children,
});

describe("ExportDocumentTreeTask", () => {
  describe("#addDocumentTreeToPathMap", () => {
    it("gives duplicate titles distinct paths in stable order", () => {
      const task =
        new TestExportDocumentTreeTask() as unknown as PathMapBuilder;
      const map = new Map<string, string>();
      const nodes = [node("1", "Doc"), node("2", "Doc"), node("3", "Doc")];

      task.addDocumentTreeToPathMap(
        map,
        nodes,
        "Col",
        FileOperationFormat.MarkdownZip
      );

      expect(map.get("/doc/doc-1")).toBe("Col/Doc.md");
      expect(map.get("/doc/doc-2")).toBe("Col/Doc (1).md");
      expect(map.get("/doc/doc-3")).toBe("Col/Doc (2).md");

      // Both url formats resolve to the same zip path per document.
      expect(map.get("/doc/1")).toBe("Col/Doc.md");
      expect(map.get("/doc/2")).toBe("Col/Doc (1).md");
      expect(map.get("/doc/3")).toBe("Col/Doc (2).md");
      expect(map.size).toBe(6);
    });

    it("avoids collisions with entries already present in the map", () => {
      const task =
        new TestExportDocumentTreeTask() as unknown as PathMapBuilder;
      const map = new Map<string, string>();

      // Mirrors addDocumentToArchive, which reserves the root document's
      // entry before mapping its children.
      map.set("/doc/root", "Col/Doc.md");

      task.addDocumentTreeToPathMap(
        map,
        [node("child-1", "Doc")],
        "Col",
        FileOperationFormat.MarkdownZip
      );

      expect(map.get("/doc/child-1")).toBe("Col/Doc (1).md");
      expect(map.get("/doc/root")).toBe("Col/Doc.md");
    });

    it("scopes child paths under the parent folder", () => {
      const task =
        new TestExportDocumentTreeTask() as unknown as PathMapBuilder;
      const map = new Map<string, string>();

      task.addDocumentTreeToPathMap(
        map,
        [node("parent", "Guide", [node("child", "Intro")])],
        "Col",
        FileOperationFormat.MarkdownZip
      );

      expect(map.get("/doc/guide-parent")).toBe("Col/Guide.md");
      expect(map.get("/doc/intro-child")).toBe("Col/Guide/Intro.md");
    });

    it("uses Untitled for documents with an empty serialized title", () => {
      const task =
        new TestExportDocumentTreeTask() as unknown as PathMapBuilder;
      const map = new Map<string, string>();

      task.addDocumentTreeToPathMap(
        map,
        [node("1", ""), node("2", "")],
        "Col",
        FileOperationFormat.MarkdownZip
      );

      expect(map.get("/doc/-1")).toBe("Col/Untitled.md");
      expect(map.get("/doc/-2")).toBe("Col/Untitled (1).md");
    });
  });
});
