import { filter, find, map } from "es-toolkit/compat";
import type { Node, ResolvedPos } from "prosemirror-model";
import type { EditorState, Selection, Transaction } from "prosemirror-state";
import { Plugin } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";
import { changedDescendants } from "../lib/changedDescendants";

type Config = Array<{
  /** Condition to meet for the placeholder to be applied to a node */
  condition: (args: {
    /** Node to which the placeholder is expected to be applied */
    node: Node;
    /** Resolved position corresponding to start of node */
    $start: ResolvedPos;
    /** Parent of node to which the placeholder is expected to be applied */
    parent: Node | null;
    /** Current editor state */
    state: EditorState;
    /** Text content of the document */
    textContent: string;
  }) => boolean;
  /** Placeholder text */
  text: string;
}>;

/**
 * Performance options for the plugin. All are optional; instances that do not
 * pass options behave exactly as before.
 */
interface PlaceholderPluginOptions {
  /**
   * Fast-path predicate. When it returns false for a document the plugin
   * short-circuits to empty decorations without walking the document at all.
   * It must only return false when no condition could match any node in the
   * document.
   */
  canMatch?: (doc: Node) => boolean;
  /**
   * Relevance predicate enabling incremental recomputation. Called for each
   * changed node during a document change; return true when the change could
   * affect any placeholder. When provided, decorations are only recomputed if
   * a relevant node changed or the selection moved into or out of a candidate
   * range; otherwise existing decorations are mapped through the transaction.
   */
  isChangedNodeRelevant?: (node: Node, $pos: ResolvedPos) => boolean;
}

/** A node range that a selection may cross into or out of. */
interface CandidateRange {
  from: number;
  to: number;
}

interface PlaceholderPluginState {
  decorations: DecorationSet;
  /** Ranges tracked for selection-crossing checks (gated instances only). */
  candidates: CandidateRange[];
}

export class PlaceholderPlugin extends Plugin<PlaceholderPluginState> {
  private canMatch?: (doc: Node) => boolean;
  private isChangedNodeRelevant?: PlaceholderPluginOptions["isChangedNodeRelevant"];
  /** Cache of fast-path results keyed by document identity. */
  private fastPathResults = new WeakMap<Node, boolean>();

  /**
   * @param config Placeholder conditions to evaluate against candidate nodes.
   * @param nodeTypes Names of the node types eligible for a placeholder.
   * Defaults to paragraphs only.
   * @param options Optional performance tuning; see
   * {@link PlaceholderPluginOptions}.
   */
  constructor(
    config: Config,
    nodeTypes: string[] = ["paragraph"],
    options: PlaceholderPluginOptions = {}
  ) {
    super({
      state: {
        init: (_, state: EditorState): PlaceholderPluginState =>
          this.createDecorations(state, config, nodeTypes, options),
        apply: (
          tr: Transaction,
          pluginState: PlaceholderPluginState,
          oldState: EditorState,
          newState: EditorState
        ): PlaceholderPluginState => {
          // Only consider work if doc or selection changed
          if (!tr.docChanged && !tr.selectionSet) {
            return pluginState;
          }

          if (this.isChangedNodeRelevant) {
            const candidates = pluginState.candidates.map((candidate) => ({
              from: tr.mapping.map(candidate.from),
              to: tr.mapping.map(candidate.to),
            }));
            const mapped: PlaceholderPluginState = {
              decorations: pluginState.decorations.map(tr.mapping, tr.doc),
              candidates,
            };

            if (
              !this.needsRecompute(
                tr,
                oldState.selection,
                newState.selection,
                pluginState.candidates,
                candidates
              )
            ) {
              return mapped;
            }
          }

          return this.createDecorations(newState, config, nodeTypes, options);
        },
      },
      props: {
        decorations: (state) => {
          const pluginState = this.getState(state);
          return pluginState ? pluginState.decorations : null;
        },
      },
    });

    this.canMatch = options.canMatch;
    this.isChangedNodeRelevant = options.isChangedNodeRelevant;
  }

  /**
   * Determines whether decorations must be fully recomputed for a transaction
   * rather than mapped. Only called for instances with a relevance predicate.
   *
   * @param tr The transaction being applied.
   * @param oldSelection Selection before the transaction.
   * @param newSelection Selection after the transaction.
   * @param previousCandidates Candidate ranges in pre-transaction coordinates.
   * @param candidates Candidate ranges mapped to post-transaction coordinates.
   * @returns True when a full recomputation is required.
   */
  private needsRecompute(
    tr: Transaction,
    oldSelection: Selection,
    newSelection: Selection,
    previousCandidates: CandidateRange[],
    candidates: CandidateRange[]
  ): boolean {
    const relevance = this.isChangedNodeRelevant;

    if (!relevance) {
      return true;
    }

    // A selection change only affects placeholders when it moves strictly
    // into or out of a tracked range; moving between positions on the same
    // side of every boundary leaves all decorations valid.
    if (tr.selectionSet) {
      const crossed = candidates.some((candidate, index) => {
        const wasInside = this.isWithin(
          oldSelection,
          previousCandidates[index]
        );
        const isInside = this.isWithin(newSelection, candidate);
        return wasInside !== isInside;
      });

      if (crossed || !tr.docChanged) {
        return crossed;
      }
    }

    if (!tr.docChanged) {
      return false;
    }

    // Walk only the changed subtrees, looking for a node the instance
    // considers relevant. Structural edits beneath a scoped node always
    // rebuild that node, so a single forward walk suffices to spot them.
    let relevant = false;
    changedDescendants(tr.before, tr.doc, 0, (node, pos) => {
      if (!relevant && relevance(node, tr.doc.resolve(pos))) {
        relevant = true;
      }
    });

    return relevant;
  }

  /**
   * Checks whether a selection's range falls strictly inside a tracked range.
   *
   * @param selection The selection to test.
   * @param candidate The tracked range.
   * @returns True when the selection is contained by the range interior.
   */
  private isWithin(selection: Selection, candidate: CandidateRange): boolean {
    return selection.from > candidate.from && selection.to < candidate.to;
  }

  /**
   * Computes the plugin state (decorations plus tracked candidate ranges) for
   * an editor state.
   *
   * @param state The editor state to compute decorations for.
   * @param config Placeholder conditions to evaluate.
   * @param nodeTypes Names of the node types eligible for a placeholder.
   * @param options Performance options for the instance.
   * @returns The computed plugin state.
   */
  private createDecorations(
    state: EditorState,
    config: Config,
    nodeTypes: string[],
    options: PlaceholderPluginOptions
  ): PlaceholderPluginState {
    const { canMatch, isChangedNodeRelevant } = options;

    if (canMatch) {
      let matches = this.fastPathResults.get(state.doc);

      if (matches === undefined) {
        matches = canMatch(state.doc);
        this.fastPathResults.set(state.doc, matches);
      }

      if (!matches) {
        // DecorationSet.empty is shared; nothing to walk or allocate.
        return { decorations: DecorationSet.empty, candidates: [] };
      }
    }

    const paras: Array<{
      node: Node;
      $start: ResolvedPos;
      parent: Node | null;
    }> = [];
    const candidates: CandidateRange[] = [];

    state.doc.descendants((node, pos, parent) => {
      if (nodeTypes.includes(node.type.name)) {
        const $start = state.doc.resolve(pos + 1);
        paras.push({ node, $start, parent });

        if (isChangedNodeRelevant) {
          // Track the node itself when it has no text (the only shape a
          // placeholder condition can target, including nodes whose content
          // is textless leaves such as hard breaks) plus every strict
          // ancestor range, since conditions compare the selection against
          // parent extents.
          if (!node.textContent) {
            candidates.push({ from: pos, to: pos + node.nodeSize });
          }
          for (let depth = 1; depth < $start.depth; depth++) {
            candidates.push({
              from: $start.before(depth),
              to: $start.after(depth),
            });
          }
        }
        return false;
      }
      return true;
    });

    // Compute the document's text content lazily: most instances' conditions
    // never read it, and materializing it eagerly costs O(doc) on every
    // recomputation. Values are memoized so conditions share one computation.
    let textContentCache: string | undefined;
    const getTextContent = () => (textContentCache ??= state.doc.textContent);

    const decorations: Decoration[] = filter(
      map(paras, (para) => {
        const condMet = find(config, (conf) =>
          conf.condition({
            node: para.node,
            $start: para.$start,
            parent: para.parent,
            state,
            get textContent() {
              return getTextContent();
            },
          })
        );
        return condMet
          ? Decoration.node(
              para.$start.pos - 1,
              para.$start.pos - 1 + para.node.nodeSize,
              {
                class: "placeholder",
                "data-empty-text": condMet.text,
              }
            )
          : undefined;
      }),
      (decoration) => decoration !== undefined
    );
    return {
      decorations: DecorationSet.create(state.doc, decorations),
      candidates,
    };
  }
}
