import type { MarkType, Node } from "prosemirror-model";
import type { EditorState, Transaction } from "prosemirror-state";
import { Plugin } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";
import { isRemoteTransaction } from "../lib/multiplayer";
import { EditorStyleHelper } from "../styles/EditorStyleHelper";

interface CodeWordDecorationsConfig {
  /** CSS class to apply to word decorations */
  className?: string;
  /** Tokens longer than this many characters are left unwrapped so they break */
  maxWordLength?: number;
}

/**
 * Check whether a node is a text node carrying the given mark.
 *
 * @param node The node to check.
 * @param markType The mark type to look for.
 * @returns True when the node is marked text.
 */
function hasCodeInlineMark(node: Node, markType: MarkType): boolean {
  return node.isText && node.marks.some((mark) => mark.type === markType);
}

/**
 * Check whether a node or any of its descendants is text carrying the given
 * mark, stopping at the first match.
 *
 * @param node The node to scan.
 * @param markType The mark type to look for.
 * @returns True when marked text exists in the subtree.
 */
function subtreeHasCodeInline(node: Node, markType: MarkType): boolean {
  if (hasCodeInlineMark(node, markType)) {
    return true;
  }
  for (let i = 0; i < node.childCount; i++) {
    if (subtreeHasCodeInline(node.child(i), markType)) {
      return true;
    }
  }
  return false;
}

class CodeWordDecorationsPlugin extends Plugin {
  constructor(config: CodeWordDecorationsConfig = {}) {
    const defaultConfig: Required<CodeWordDecorationsConfig> = {
      className: EditorStyleHelper.codeWord,
      maxWordLength: 40,
    };

    const finalConfig = { ...defaultConfig, ...config };

    super({
      state: {
        init: (_, state: EditorState) => ({
          decorations: this.createDecorations(state, finalConfig),
        }),
        apply: (tr, pluginState, _oldState, newState) => {
          if (!tr.docChanged) {
            return pluginState;
          }

          if (isRemoteTransaction(tr) || this.hasCodeInlineChange(tr)) {
            return {
              decorations: this.createDecorations(newState, finalConfig),
            };
          }

          return {
            decorations: pluginState.decorations.map(tr.mapping, tr.doc),
          };
        },
      },
      props: {
        decorations: (state) => {
          const pluginState = this.getState(state);
          return pluginState ? pluginState.decorations : null;
        },
      },
    });
  }

  /**
   * Check if the transaction changed any text nodes with code_inline marks,
   * covering additions, edits, and deletions in a single traversal over the
   * changed regions only.
   */
  private hasCodeInlineChange(tr: Transaction): boolean {
    const codeMarkType = tr.doc.type.schema.marks.code_inline;
    if (!codeMarkType) {
      return false;
    }

    return this.changedNodeHasCodeInline(tr.before, tr.doc, codeMarkType);
  }

  /**
   * Walks the nodes that changed between two versions of a node, mirroring
   * the pairing heuristic of changedDescendants, and checks both sides of
   * each changed region for marked text so a single pass replaces separate
   * forward and backward scans. Stops at the first match.
   *
   * @param oldNode The previous version of the node.
   * @param curNode The current version of the node.
   * @param markType The mark type to look for.
   * @returns True when a changed text node carries the mark.
   */
  private changedNodeHasCodeInline(
    oldNode: Node,
    curNode: Node,
    markType: MarkType
  ): boolean {
    const oldSize = oldNode.childCount,
      curSize = curNode.childCount;

    let j = 0;
    outer: for (let i = 0; i < curSize; i++) {
      const child = curNode.child(i);
      for (let scan = j, e = Math.min(oldSize, i + 3); scan < e; scan++) {
        if (oldNode.child(scan) === child) {
          j = scan + 1;
          continue outer;
        }
      }

      // The child is new or rewritten on the current side.
      if (hasCodeInlineMark(child, markType)) {
        return true;
      }

      let found = false;
      if (j < oldSize && oldNode.child(j).sameMarkup(child)) {
        found = this.changedNodeHasCodeInline(
          oldNode.child(j),
          child,
          markType
        );
      } else {
        child.nodesBetween(0, child.content.size, (node) => {
          if (hasCodeInlineMark(node, markType)) {
            found = true;
            return false;
          }
          return true;
        });

        // A wholesale replacement may also have deleted marked content on
        // the previous side; check the replaced counterpart as well.
        if (!found && j < oldSize) {
          found = subtreeHasCodeInline(oldNode.child(j), markType);
        }
      }

      if (found) {
        return true;
      }
    }

    // Trailing deletions: previous children with no current counterpart.
    for (; j < oldSize; j++) {
      if (subtreeHasCodeInline(oldNode.child(j), markType)) {
        return true;
      }
    }

    return false;
  }

  private createDecorations(
    state: EditorState,
    config: Required<CodeWordDecorationsConfig>
  ) {
    const decorations: Decoration[] = [];
    const codeMarkType = state.schema.marks.code_inline;

    if (!codeMarkType) {
      return DecorationSet.empty;
    }

    state.doc.descendants((node, pos) => {
      if (node.isText && node.text) {
        // Check if this text node has the code_inline mark
        const codeMark = node.marks.find((mark) => mark.type === codeMarkType);

        if (codeMark) {
          const text = node.text;

          // Split on spaces only rather than word breaks for code
          const words = text.split(" ");
          let currentPos = pos;

          for (let i = 0; i < words.length; i++) {
            const word = words[i];

            // Tokens longer than a line cannot move to the next line as a unit,
            // so leave them unwrapped to inherit the editor's default breaking
            // rather than overflow.
            if (word.length > 0 && word.length <= config.maxWordLength) {
              const wordStart = currentPos;
              const wordEnd = wordStart + word.length;

              // Create a decoration for each word
              decorations.push(
                Decoration.inline(wordStart, wordEnd, {
                  class: config.className,
                  nodeName: "span",
                })
              );
            }

            // Move position forward by word length + 1 for the space
            currentPos += word.length + 1;
          }
        }
      }
      return true;
    });

    return DecorationSet.create(state.doc, decorations);
  }
}

/**
 * Creates a plugin that decorates individual words inside inline code marks
 * with span elements.
 */
export function codeWordDecorations(config: CodeWordDecorationsConfig = {}) {
  return new CodeWordDecorationsPlugin(config);
}
