import type { Server } from "socket.io";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from "vitest";
import type { DocumentEvent } from "@server/types";
import type { default as WebsocketsProcessor } from "./WebsocketsProcessor";

const findByPk = vi.hoisted(() => vi.fn());
const findAll = vi.hoisted(() => vi.fn());
const presentDocumentMock = vi.hoisted(() => vi.fn());

vi.mock("@server/models", () => ({
  Comment: {},
  Collection: {},
  Document: { findByPk },
  FileOperation: {},
  Group: {},
  GroupMembership: { findAll },
  GroupUser: {},
  Pin: {},
  Star: {},
  Team: {},
  Subscription: {},
  Notification: {},
  UserMembership: { findAll },
  User: {},
  Import: {},
  Template: {},
}));

vi.mock("@server/policies", () => ({
  cannot: vi.fn(() => false),
}));

vi.mock("@server/presenters", () => ({
  presentComment: vi.fn(),
  presentCollection: vi.fn(),
  presentDocument: presentDocumentMock,
  presentFileOperation: vi.fn(),
  presentGroup: vi.fn(),
  presentPin: vi.fn(),
  presentStar: vi.fn(),
  presentSubscription: vi.fn(),
  presentTeam: vi.fn(),
  presentMembership: vi.fn(),
  presentUser: vi.fn(),
  presentGroupMembership: vi.fn(),
  presentGroupUser: vi.fn(),
  presentImport: vi.fn(),
}));

vi.mock("@server/presenters/notification", () => ({
  default: vi.fn(),
}));

/** Matches the coalescing window defined in WebsocketsProcessor. */
const COALESCE_MS = 1000;

// The processor module may already have been evaluated while test setup files
// loaded, capturing real model bindings before the mocks above were
// registered. Reset the module registry and import it dynamically so the
// class under test binds to the mocked modules instead.
let WebsocketsProcessorClass: typeof WebsocketsProcessor;

interface SocketStub {
  io: Server;
  to: ReturnType<typeof vi.fn>;
  emit: ReturnType<typeof vi.fn>;
}

/**
 * Builds a minimal socket.io server stub capturing rooms and emissions.
 *
 * @return The stub plus spies for its `to` and `emit` calls.
 */
function createSocketio(): SocketStub {
  const emit = vi.fn();
  const to = vi.fn(() => ({ emit }));

  return {
    to,
    emit,
    io: { to, emit } as unknown as Server,
  };
}

/**
 * Builds a `documents.update` event.
 *
 * @param props Optional fields to override the defaults.
 * @return A document update event.
 */
function buildUpdateEvent(
  props: Partial<
    Pick<DocumentEvent & { name: "documents.update" }, "documentId" | "actorId">
  > = {}
): DocumentEvent {
  return {
    name: "documents.update",
    teamId: "team-1",
    actorId: "user-1",
    ip: null,
    createdAt: new Date().toISOString(),
    documentId: "doc-1",
    collectionId: "collection-1",
    ...props,
  };
}

/**
 * Builds a `documents.archive` event, which shares the immediate handler.
 *
 * @param props Optional fields to override the defaults.
 * @return A document archive event.
 */
function buildArchiveEvent(
  props: Partial<
    Pick<
      DocumentEvent & { name: "documents.archive" },
      "documentId" | "collectionId"
    >
  > = {}
): DocumentEvent {
  return {
    name: "documents.archive",
    teamId: "team-1",
    actorId: "user-1",
    ip: null,
    documentId: "doc-1",
    collectionId: "collection-1",
    ...props,
  };
}

describe("WebsocketsProcessor documents.update coalescing", () => {
  let processor: InstanceType<typeof WebsocketsProcessor>;

  beforeAll(async () => {
    vi.resetModules();
    ({ default: WebsocketsProcessorClass } =
      await import("./WebsocketsProcessor"));
  });

  beforeEach(() => {
    processor = new WebsocketsProcessorClass();
    vi.useFakeTimers();
    findByPk.mockResolvedValue({
      id: "doc-1",
      publishedAt: new Date(),
      collectionId: "collection-1",
    });
    findAll.mockResolvedValue([]);
    presentDocumentMock.mockImplementation(
      (_ctx: unknown, document: { id: string }) =>
        Promise.resolve({ id: document.id })
    );
  });

  afterEach(async () => {
    // Drain any pending coalescing windows so module-level state stays clean.
    await vi.advanceTimersByTimeAsync(COALESCE_MS * 2);
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  afterAll(() => {
    vi.restoreAllMocks();
  });

  test("coalesces rapid updates for the same document into a single broadcast", async () => {
    const { io, to, emit } = createSocketio();

    await processor.perform(buildUpdateEvent(), io);
    await processor.perform(buildUpdateEvent({ actorId: "user-2" }), io);
    await processor.perform(buildUpdateEvent({ actorId: "user-3" }), io);

    // Nothing is presented or broadcast before the window elapses.
    await vi.advanceTimersByTimeAsync(COALESCE_MS - 1);
    expect(findByPk).not.toHaveBeenCalled();
    expect(emit).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);

    expect(findByPk).toHaveBeenCalledTimes(1);
    expect(findByPk).toHaveBeenCalledWith("doc-1", { paranoid: false });
    expect(presentDocumentMock).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith("documents.update", { id: "doc-1" });
    // latest wins: only the channels of the most recent event are targeted
    expect(to).toHaveBeenCalledWith(["user-user-3", "collection-collection-1"]);
  });

  test("updates for different documents do not block each other", async () => {
    const { io } = createSocketio();

    await processor.perform(buildUpdateEvent({ documentId: "doc-a" }), io);
    await vi.advanceTimersByTimeAsync(COALESCE_MS / 2);

    // doc-b's window starts later and must not be affected by doc-a's.
    await processor.perform(buildUpdateEvent({ documentId: "doc-b" }), io);

    await vi.advanceTimersByTimeAsync(COALESCE_MS / 2);
    expect(findByPk).toHaveBeenCalledTimes(1);
    expect(findByPk).toHaveBeenCalledWith("doc-a", { paranoid: false });
    expect(findByPk).not.toHaveBeenCalledWith("doc-b", { paranoid: false });

    await vi.advanceTimersByTimeAsync(COALESCE_MS / 2);
    expect(findByPk).toHaveBeenCalledTimes(2);
    expect(findByPk).toHaveBeenLastCalledWith("doc-b", { paranoid: false });
  });

  test("non-update events are broadcast immediately", async () => {
    const { io, emit } = createSocketio();

    await processor.perform(buildArchiveEvent(), io);

    await vi.advanceTimersByTimeAsync(0);

    expect(findByPk).toHaveBeenCalledTimes(1);
    expect(presentDocumentMock).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith("documents.archive", { id: "doc-1" });
  });
});
