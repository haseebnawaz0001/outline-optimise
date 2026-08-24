import path from "node:path";
import {
  AttachmentReferenceIndex,
  rewriteAttachmentPaths,
  rewriteInternalLinks,
} from "./MarkdownAPIImportTask";
import type { MarkdownAttachmentManifestItem } from "@shared/schema";

/**
 * The original implementation this optimization must remain equivalent to.
 */
const naiveAttachmentsReferencedBy = (
  markdown: string,
  manifest: MarkdownAttachmentManifestItem[]
): MarkdownAttachmentManifestItem[] =>
  manifest.filter((item) => {
    const fileName = path.basename(item.pathInZip);
    return (
      markdown.includes(fileName) || markdown.includes(encodeURI(fileName))
    );
  });

describe("rewriteAttachmentPaths", () => {
  it("replaces a direct encoded path with the placeholder", () => {
    const out = rewriteAttachmentPaths(
      "![alt](My%20Collection/attachments/foo.png)",
      [{ id: "att-1", pathInZip: "My Collection/attachments/foo.png" }]
    );
    expect(out).toBe("![alt](<<att-1>>)");
  });

  it("normalizes legacy `uploads/` bucket layout", () => {
    const out = rewriteAttachmentPaths("![x](./uploads/abc/file.png)", [
      {
        id: "att-2",
        pathInZip: "Some Collection/uploads/abc/file.png",
      },
    ]);
    expect(out).toBe("![x](<<att-2>>)");
  });

  it("normalizes legacy `public/` bucket layout", () => {
    const out = rewriteAttachmentPaths("![x](./public/abc/file.png)", [
      {
        id: "att-3",
        pathInZip: "Some Collection/public/abc/file.png",
      },
    ]);
    expect(out).toBe("![x](<<att-3>>)");
  });

  it("handles arbitrary folder names like 'attachments/'", () => {
    const out = rewriteAttachmentPaths("![x](./attachments/foo.png)", [
      { id: "att-4", pathInZip: "Collection/attachments/foo.png" },
    ]);
    expect(out).toBe("![x](<<att-4>>)");
  });

  it("matches nested attachments folders", () => {
    const out = rewriteAttachmentPaths("![x](./attachments/sub/bar.png)", [
      {
        id: "att-5",
        pathInZip: "Collection/Doc/attachments/sub/bar.png",
      },
    ]);
    expect(out).toBe("![x](<<att-5>>)");
  });

  it("substitutes multiple references in the same document", () => {
    const out = rewriteAttachmentPaths(
      "![a](./attachments/a.png) and ![b](./attachments/b.png)",
      [
        { id: "id-a", pathInZip: "C/attachments/a.png" },
        { id: "id-b", pathInZip: "C/attachments/b.png" },
      ]
    );
    expect(out).toBe("![a](<<id-a>>) and ![b](<<id-b>>)");
  });

  it("is a no-op when no attachments match", () => {
    const out = rewriteAttachmentPaths("![x](https://example.com/a.png)", [
      { id: "id-a", pathInZip: "C/attachments/a.png" },
    ]);
    expect(out).toBe("![x](https://example.com/a.png)");
  });

  it("leaves remote signed URLs untouched so the base task can download them", () => {
    // Slab exports reference images as remote signed URLs rather than files
    // in the zip; these aren't in the manifest and must survive rewriting so
    // the per-page attachment upload step can fetch and re-host them.
    const signedUrl =
      "https://uploads.slab.com/posts/abc/image.png?Signature=xyz&Expires=123";
    const out = rewriteAttachmentPaths(`![x](${signedUrl})`, [
      { id: "id-a", pathInZip: "C/attachments/local.png" },
    ]);
    expect(out).toBe(`![x](${signedUrl})`);
  });

  it("produces identical output when called repeatedly with cached patterns", () => {
    const markdown =
      "![a](./attachments/a.png) ![b](My%20Doc/images/b.png) ![c](C/uploads/legacy/c.png)";
    const attachments = [
      { id: "id-a", pathInZip: "C/attachments/a.png" },
      { id: "id-b", pathInZip: "C/Doc/images/b.png" },
      { id: "id-c", pathInZip: "C/uploads/legacy/c.png" },
    ];

    const first = rewriteAttachmentPaths(markdown, attachments);
    const second = rewriteAttachmentPaths(markdown, attachments);
    expect(second).toBe(first);
    expect(first).toMatchInlineSnapshot(
      `"![a](<<id-a>>) ![b](My%20Doc<<id-b>>) ![c](<<id-c>>)"`
    );
  });
});

describe("AttachmentReferenceIndex", () => {
  const manifest: MarkdownAttachmentManifestItem[] = [
    {
      id: "m1",
      name: "a.png",
      pathInZip: "C/attachments/a.png",
      mimeType: "image/png",
    },
    {
      id: "m2",
      name: "ca.png",
      pathInZip: "C/attachments/ca.png",
      mimeType: "image/png",
    },
    {
      id: "m3",
      name: "logo.png",
      pathInZip: "C/images/logo.png",
      mimeType: "image/png",
    },
    {
      // Same basename as m3 but a different directory; both must resolve.
      id: "m4",
      name: "logo.png",
      pathInZip: "Other/docs/logo.png",
      mimeType: "image/png",
    },
    {
      id: "m5",
      name: "my diagram.svg",
      pathInZip: "C/diagrams/my diagram.svg",
      mimeType: "image/svg+xml",
    },
    {
      // Case differs from every reference below and must never match.
      id: "m6",
      name: "LOGO.PNG",
      pathInZip: "C/images/LOGO.PNG",
      mimeType: "image/png",
    },
  ];

  const markdownFixtures = [
    "",
    "no references here at all",
    "![first](./attachments/a.png)",
    "overlapping: ca.png and a.png in one line",
    "encoded only: C/images/logo%20variant.png",
    "encoded space: ./diagrams/my%20diagram.svg",
    "raw space: diagrams/my diagram.svg",
    "case must not match: logo.png vs LOGO.PNG",
    "substring semantics: footnote.md2 mentions note.md",
    "all of them: a.png ca.png logo.png my%20diagram.svg LOGO.PNG note.md",
  ];

  it("matches the naive manifest filter on fixtures", () => {
    const index = new AttachmentReferenceIndex(manifest);

    for (const markdown of markdownFixtures) {
      expect(index.referencedBy(markdown)).toEqual(
        naiveAttachmentsReferencedBy(markdown, manifest)
      );
    }
  });

  it("returns entries in manifest order regardless of mention order", () => {
    const index = new AttachmentReferenceIndex(manifest);
    const result = index.referencedBy("ca.png then a.png then LOGO.PNG");
    expect(result.map((item) => item.id)).toEqual(["m1", "m2", "m6"]);
    expect(result).toEqual(
      naiveAttachmentsReferencedBy("ca.png then a.png then LOGO.PNG", manifest)
    );
  });

  it("resolves duplicate basenames to every manifest entry sharing the name", () => {
    const index = new AttachmentReferenceIndex(manifest);
    const result = index.referencedBy("see images/logo.png");
    expect(result.map((item) => item.id)).toEqual(["m3", "m4"]);
  });

  it("returns an empty array when the manifest is empty", () => {
    const index = new AttachmentReferenceIndex([]);
    expect(index.referencedBy("a.png")).toEqual([]);
  });
});

describe("rewriteInternalLinks", () => {
  it("rewrites a sibling .md link to a placeholder", () => {
    const out = rewriteInternalLinks(
      "see [other](./other.md)",
      "Collection/parent.md",
      { "Collection/other.md": "doc-1" }
    );
    expect(out).toBe("see [other](<<doc-1>>)");
  });

  it("rewrites a nested .md link", () => {
    const out = rewriteInternalLinks(
      "see [child](./sub/child.md)",
      "Collection/parent.md",
      { "Collection/sub/child.md": "doc-2" }
    );
    expect(out).toBe("see [child](<<doc-2>>)");
  });

  it("leaves unresolved .md links untouched", () => {
    const out = rewriteInternalLinks(
      "see [missing](./missing.md)",
      "Collection/parent.md",
      {}
    );
    expect(out).toBe("see [missing](./missing.md)");
  });

  it("ignores non-md links", () => {
    const out = rewriteInternalLinks(
      "see [site](https://example.com)",
      "Collection/parent.md",
      { "Collection/parent.md": "doc-self" }
    );
    expect(out).toBe("see [site](https://example.com)");
  });

  it("decodes encoded path segments before lookup", () => {
    const out = rewriteInternalLinks(
      "see [other](./My%20Doc.md)",
      "Collection/parent.md",
      { "Collection/My Doc.md": "doc-3" }
    );
    expect(out).toBe("see [other](<<doc-3>>)");
  });

  it("rewrites an angle bracketed link to a document with spaces", () => {
    const out = rewriteInternalLinks(
      "see [other](<./My Doc.md>)",
      "Collection/parent.md",
      { "Collection/My Doc.md": "doc-4" }
    );
    expect(out).toBe("see [other](<<doc-4>>)");
  });

  it("rewrites a link carrying a title, keeping the title", () => {
    const out = rewriteInternalLinks(
      'see [other](./other.md "The other one")',
      "Collection/parent.md",
      { "Collection/other.md": "doc-5" }
    );
    expect(out).toBe('see [other](<<doc-5>> "The other one")');
  });
});
