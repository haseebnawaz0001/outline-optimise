import { flattenDeep, padStart } from "es-toolkit/compat";
import type { Node } from "prosemirror-model";
import type { Transaction } from "prosemirror-state";
import { Plugin, PluginKey } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";
import type refractorType from "refractor/core";
import { getLoaderForLanguage, getRefractorLangForLanguage } from "../lib/code";
import { isRemoteTransaction } from "../lib/multiplayer";
import { findBlockNodes } from "../queries/findChildren";

type ParsedNode = {
  text: string;
  classes: string[];
};

/**
 * A decoration stored relative to the start of its code block so cached
 * entries survive the block moving to a different position.
 */
type RelativeDecoration =
  | {
      type: "inline";
      from: number;
      to: number;
      className: string;
    }
  | {
      type: "node";
      from: number;
      to: number;
      attrs: {
        "data-line-numbers": string;
        style: string;
      };
      spec: { key: string };
    };

interface HighlightCacheEntry {
  /** The language attribute of the cached block. */
  language: string;
  /**
   * Whether syntax highlighting was applied. Entries created while the
   * language was still loading are rebuilt once it registers.
   */
  highlighted: boolean;
  /** Decorations relative to the start of their code block. */
  decorations: RelativeDecoration[];
}

/**
 * Cache keyed by node identity rather than position: ProseMirror nodes are
 * immutable, so untouched blocks keep their identity across position shifts
 * caused by edits elsewhere in the document.
 */
const cache = new WeakMap<Node, HighlightCacheEntry>();
const languagesToImport = new Set<string>();
const languagePromises: Record<
  string,
  Promise<string | undefined> | undefined
> = {};

let refractor: typeof refractorType | undefined;

/**
 * Lazily load refractor core, memoizing the instance for highlighting.
 *
 * @returns The loaded refractor core module.
 */
export async function getRefractor() {
  refractor ??= (await import("refractor/core")).default;
  return refractor;
}

async function loadLanguage(language: string) {
  const r = await getRefractor();
  if (!language || r.registered(language)) {
    return;
  }

  if (languagePromises[language]) {
    return languagePromises[language];
  }

  const loader = getLoaderForLanguage(language);
  if (!loader) {
    return;
  }

  languagePromises[language] = loader()
    .then((syntax) => {
      r.register(syntax);
      return language;
    })
    .catch((err) => {
      // It will retry loading the language on the next render
      // oxlint-disable-next-line no-console
      console.error(
        `Failed to load language ${language} for code highlighting`,
        err
      );
      delete languagePromises[language]; // Remove failed promise from cache
      return undefined;
    });

  return languagePromises[language];
}

/**
 * Rebuilds an absolute decoration from a cached relative one at a block's
 * current position.
 *
 * @param decoration The relative decoration to materialize.
 * @param blockPos Current absolute position of the code block.
 * @returns The absolute decoration.
 */
function materializeDecoration(
  decoration: RelativeDecoration,
  blockPos: number
): Decoration {
  if (decoration.type === "node") {
    return Decoration.node(
      blockPos + decoration.from,
      blockPos + decoration.to,
      decoration.attrs,
      decoration.spec
    );
  }

  return Decoration.inline(
    blockPos + decoration.from,
    blockPos + decoration.to,
    {
      class: decoration.className,
    }
  );
}

function getDecorations({
  doc,
  name,
  lineNumbers,
}: {
  /** The prosemirror document to operate on. */
  doc: Node;
  /** The node name. */
  name: string;
  /** Whether to include decorations representing line numbers */
  lineNumbers?: boolean;
}) {
  const decorations: Decoration[] = [];
  const blocks: { node: Node; pos: number }[] = findBlockNodes(
    doc,
    true
  ).filter((item) => item.node.type.name === name);

  function parseNodes(
    nodes: refractorType.RefractorNode[],
    classNames: string[] = []
  ): {
    text: string;
    classes: string[];
  }[] {
    return flattenDeep(
      nodes.map((node) => {
        if (node.type === "element") {
          const classes = [...classNames, ...(node.properties.className || [])];
          return parseNodes(node.children, classes);
        }

        return {
          text: node.value,
          classes: classNames,
        };
      })
    );
  }

  blocks.forEach((block) => {
    const language: string = block.node.attrs.language;
    const lang = getRefractorLangForLanguage(language);
    const langReady = !!lang && !!refractor?.registered(lang);

    let entry = cache.get(block.node);

    // Cache misses are keyed on node identity: an untouched block keeps its
    // entry even after upstream edits shift its position. An entry created
    // while the block's language was still loading is rebuilt once loaded.
    if (!entry || (langReady && !entry.highlighted)) {
      const relativeDecorations: RelativeDecoration[] = [];

      if (lineNumbers && !block.node.attrs.wrap) {
        const lineCount =
          (block.node.textContent.match(/\n/g) || []).length + 1;
        const gutterWidth = String(lineCount).length;

        const lineCountText = Array.from({ length: lineCount })
          .map((_, i) => padStart(`${i + 1}`, gutterWidth, " "))
          .join("\n");

        relativeDecorations.push({
          type: "node",
          from: 0,
          to: block.node.nodeSize,
          attrs: {
            "data-line-numbers": lineCountText,
            style: `--line-number-gutter-width: ${gutterWidth};`,
          },
          spec: {
            key: `line-${lineCount}-gutter`,
          },
        });
      }

      if (!lang) {
        // do nothing
        entry = {
          language,
          highlighted: true,
          decorations: relativeDecorations,
        };
      } else if (langReady) {
        languagesToImport.delete(language);

        const nodes = refractor!.highlight(block.node.textContent, lang);
        let startPos = 1;
        const inlineDecorations = parseNodes(nodes)
          .map((node: ParsedNode) => {
            const from = startPos;
            const to = from + node.text.length;

            startPos = to;

            return {
              ...node,
              from,
              to,
            };
          })
          .filter((node) => node.classes && node.classes.length)
          .map(
            (node): RelativeDecoration => ({
              type: "inline",
              from: node.from,
              to: node.to,
              className: node.classes.join(" "),
            })
          );

        entry = {
          language,
          highlighted: true,
          decorations: [...inlineDecorations, ...relativeDecorations],
        };
      } else {
        languagesToImport.add(language);
        entry = {
          language,
          highlighted: false,
          decorations: relativeDecorations,
        };
      }

      cache.set(block.node, entry);
    }

    entry.decorations.forEach((decoration) => {
      decorations.push(materializeDecoration(decoration, block.pos));
    });
  });

  return DecorationSet.create(doc, decorations);
}

export function CodeHighlighting({
  name,
  lineNumbers,
}: {
  /** The node name. */
  name: string;
  /** Whether to include decorations representing line numbers */
  lineNumbers?: boolean;
}) {
  let highlighted = false;

  return new Plugin({
    key: new PluginKey("codeHighlighting"),
    state: {
      init: (_, { doc }) => DecorationSet.create(doc, []),
      apply: (transaction: Transaction, decorationSet, oldState, state) => {
        const nodeName = state.selection.$head.parent.type.name;
        const previousNodeName = oldState.selection.$head.parent.type.name;
        const codeBlockChanged =
          transaction.docChanged && [nodeName, previousNodeName].includes(name);

        // @ts-expect-error accessing private field.
        const isPaste = transaction.meta?.paste;
        const langLoaded = transaction.getMeta("codeHighlighting")?.langLoaded;

        if (
          !highlighted ||
          codeBlockChanged ||
          isPaste ||
          langLoaded ||
          isRemoteTransaction(transaction)
        ) {
          highlighted = true;
          return getDecorations({ doc: transaction.doc, name, lineNumbers });
        }

        return decorationSet.map(transaction.mapping, transaction.doc);
      },
    },
    view: (view) => {
      if (!highlighted) {
        void getRefractor().then(() => {
          if (!view.isDestroyed) {
            view.dispatch(
              view.state.tr.setMeta("codeHighlighting", {
                langLoaded: true,
              })
            );
          }
        });
      }
      return {
        update: () => {
          if (!languagesToImport.size) {
            return;
          }

          void Promise.all([...languagesToImport].map(loadLanguage)).then(
            (results) => {
              const loaded = results.filter((lang): lang is string => !!lang);
              if (loaded.length && !view.isDestroyed) {
                view.dispatch(
                  view.state.tr.setMeta("codeHighlighting", {
                    langLoaded: loaded,
                  })
                );
              }
            }
          );
        },
      };
    },
    props: {
      decorations(state) {
        return this.getState(state);
      },
    },
  });
}
