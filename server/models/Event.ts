import type {
  CreateOptions,
  InferAttributes,
  InferCreationAttributes,
  SaveOptions,
  WhereOptions,
} from "sequelize";
import {
  ForeignKey,
  AfterSave,
  BeforeCreate,
  BelongsTo,
  Column,
  IsIP,
  IsUUID,
  Table,
  DataType,
  Length,
} from "sequelize-typescript";
import { globalEventQueue } from "../queues";
import type { APIContext } from "../types";
import { AuthenticationType } from "../types";
import { normalizeIp } from "../utils/ip";
import Collection from "./Collection";
import Document from "./Document";
import Team from "./Team";
import User from "./User";
import IdModel from "./base/IdModel";
import type { Context } from "koa";

/** The maximum serialized length of a single value within enqueued event changes. */
const MAX_ENQUEUED_VALUE_LENGTH = 8192;

/** The placeholder that replaces oversized values in enqueued event changes. */
const STRIPPED_VALUE = "[stripped]";

/**
 * Recursively walks the given value and replaces any value whose serialized
 * form exceeds MAX_ENQUEUED_VALUE_LENGTH with a placeholder string. Values
 * below the limit are returned untouched.
 *
 * @param value The value to walk.
 * @returns The value with any oversized entries replaced by "[stripped]".
 */
// oxlint-disable-next-line @typescript-eslint/no-explicit-any
function stripOversizedValues(value: any): any {
  if (value === undefined) {
    return value;
  }

  if (JSON.stringify(value).length <= MAX_ENQUEUED_VALUE_LENGTH) {
    return value;
  }

  if (typeof value !== "object") {
    return STRIPPED_VALUE;
  }

  if (Array.isArray(value)) {
    return value.map(stripOversizedValues);
  }

  const result: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value)) {
    result[key] = stripOversizedValues(val);
  }
  return result;
}

@Table({ tableName: "events", modelName: "event", updatedAt: false })
class Event extends IdModel<
  InferAttributes<Event>,
  Partial<InferCreationAttributes<Event>>
> {
  @IsUUID(4)
  @Column(DataType.UUID)
  modelId: string | null;

  /** The name of the event. */
  @Length({
    max: 255,
    msg: "name must be 255 characters or less",
  })
  @Column(DataType.STRING)
  name: string;

  /** The originating IP address of the event. */
  @IsIP
  @Column(DataType.STRING)
  ip: string | null;

  /** The type of authentication used to create the event. */
  @Column(DataType.ENUM(...Object.values(AuthenticationType)))
  authType: AuthenticationType | null;

  /**
   * Metadata associated with the event, previously used for storing some changed attributes.
   * Note that the `data` column will be visible to the client and API requests.
   */
  @Column(DataType.JSONB)
  // oxlint-disable-next-line @typescript-eslint/no-explicit-any
  data: Record<string, any> | null;

  /**
   * The changes made to the model – gradually moving to this column away from `data` which can be
   * used for arbitrary data associated with the event.
   */
  @Column(DataType.JSONB)
  // oxlint-disable-next-line @typescript-eslint/no-explicit-any
  changes: Record<string, any> | null;

  // hooks

  @BeforeCreate
  static cleanupIp(model: Event) {
    model.ip = normalizeIp(model.ip);
  }

  /**
   * Prepare an event for enqueueing by replacing oversized values in `changes`
   * with a placeholder, so that large document payloads never reach the queue.
   * This runs after persistence and only affects the queued copy of the event,
   * the database record is left untouched.
   *
   * @param model The event to prepare for the queue.
   * @returns The same event instance with oversized change values stripped.
   */
  static stripForQueue(model: Event): Event {
    const { attributes, previous } = model.changes ?? {};
    if (!attributes && !previous) {
      return model;
    }

    model.changes = {
      attributes: attributes ? stripOversizedValues(attributes) : attributes,
      previous: previous ? stripOversizedValues(previous) : previous,
    };
    return model;
  }

  @AfterSave
  static async enqueue(
    model: Event,
    options: SaveOptions<InferAttributes<Event>>
  ) {
    if (options.transaction) {
      // 'findOrCreate' creates a new transaction always, and the transaction from the middleware is set as its parent.
      // We want to use the parent transaction, otherwise the 'afterCommit' hook will never fire in this case.
      // See: https://github.com/sequelize/sequelize/issues/17452
      (options.transaction.parent || options.transaction).afterCommit(
        () => void globalEventQueue().add(Event.stripForQueue(model))
      );
      return;
    }
    void globalEventQueue().add(Event.stripForQueue(model));
  }

  // associations

  @BelongsTo(() => User, "userId")
  user: User | null;

  @ForeignKey(() => User)
  @Column(DataType.UUID)
  userId: string | null;

  @BelongsTo(() => Document, "documentId")
  document: Document | null;

  @ForeignKey(() => Document)
  @Column(DataType.UUID)
  documentId: string | null;

  @BelongsTo(() => User, "actorId")
  actor: User;

  @ForeignKey(() => User)
  @Column(DataType.UUID)
  actorId: string | null;

  @BelongsTo(() => Collection, "collectionId")
  collection: Collection | null;

  @ForeignKey(() => Collection)
  @Column(DataType.UUID)
  collectionId: string | null;

  @BelongsTo(() => Team, "teamId")
  team: Team;

  @ForeignKey(() => Team)
  @Column(DataType.UUID)
  teamId: string;

  /*
   * Schedule can be used to send events into the event system without recording
   * them in the database or audit trail – consider using a task instead.
   */
  static schedule(event: Partial<Event>) {
    const now = new Date();
    return globalEventQueue().add(
      Event.stripForQueue(
        this.build({
          createdAt: now,
          ...event,
        })
      )
    );
  }

  /**
   * Find the latest event matching the where clause
   *
   * @param where The options to match against
   * @returns A promise resolving to the latest event or null
   */
  static findLatest(where: WhereOptions) {
    return this.findOne({
      where,
      order: [["createdAt", "DESC"]],
    });
  }

  /**
   * Create and persist new event from request context
   *
   * @param ctx The request context to use
   * @param attributes The event attributes
   * @returns A promise resolving to the new event
   */
  static createFromContext(
    ctx: Context | APIContext,
    attributes: Omit<Partial<Event>, "ip" | "teamId" | "actorId"> = {},
    defaultAttributes: Pick<Partial<Event>, "ip" | "teamId" | "actorId"> = {},
    options?: CreateOptions<InferAttributes<Event>>
  ) {
    const user = ctx.state.auth?.user;
    const authType = ctx.state.auth?.type;

    return this.create(
      {
        ...attributes,
        actorId: user?.id || defaultAttributes.actorId,
        teamId: user?.teamId || defaultAttributes.teamId,
        ip: ctx.request?.ip || defaultAttributes.ip,
        authType,
      },
      {
        transaction: ctx.state.transaction,
        ...options,
      }
    );
  }
}

export default Event;
