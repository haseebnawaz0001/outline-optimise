import { randomUUID } from "crypto";
import JWT from "jsonwebtoken";
import env from "@server/env";
import { Team, User } from "@server/models";
import { __resetUserCacheForTests, getUserForJWT } from "./jwt";

const TEST_SECRET_KEY = "1".repeat(64);
const TEST_JWT_SECRET = "test-jwt-secret";

const buildUser = (overrides: Partial<{ suspendedAt: Date }> = {}) => {
  const user = User.build({
    id: randomUUID(),
    teamId: randomUUID(),
    email: "user@example.com",
    name: "Test User",
    jwtSecret: TEST_JWT_SECRET,
    suspendedAt: overrides.suspendedAt ?? null,
  });
  user.team = Team.build({ id: user.teamId, name: "Test Team" });
  return user;
};

const createToken = (
  user: User,
  type = "session",
  overrides: Record<string, unknown> = {}
) =>
  JWT.sign(
    {
      id: user.id,
      type,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      createdAt: new Date().toISOString(),
      ...overrides,
    },
    user.jwtSecret,
    { algorithm: "HS256" }
  );

describe("getUserForJWT", () => {
  let findByPkSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    env.SECRET_KEY = TEST_SECRET_KEY;
    __resetUserCacheForTests();
    findByPkSpy = vi.spyOn(User, "findByPk");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("resolves the user from the database on first request", async () => {
    const user = buildUser();
    findByPkSpy.mockResolvedValue(user);

    const result = await getUserForJWT(createToken(user));

    expect(findByPkSpy).toHaveBeenCalledTimes(1);
    expect(result.user).toBe(user);
  });

  it("serves subsequent requests for the same token from the cache without hitting the database", async () => {
    const user = buildUser();
    findByPkSpy.mockResolvedValue(user);
    const token = createToken(user);

    const first = await getUserForJWT(token);
    const second = await getUserForJWT(token);

    expect(findByPkSpy).toHaveBeenCalledTimes(1);
    expect(second.user).toBe(first.user);
  });

  it("still verifies the token signature on cache hits", async () => {
    const user = buildUser();
    findByPkSpy.mockResolvedValue(user);
    const token = createToken(user);
    const verifySpy = vi.spyOn(JWT, "verify");

    await getUserForJWT(token);
    await getUserForJWT(token);

    expect(findByPkSpy).toHaveBeenCalledTimes(1);
    expect(verifySpy).toHaveBeenCalledTimes(2);
    expect(verifySpy).toHaveBeenNthCalledWith(1, token, TEST_JWT_SECRET);
    expect(verifySpy).toHaveBeenNthCalledWith(2, token, TEST_JWT_SECRET);
  });

  it("refetches after the cache TTL expires", async () => {
    vi.useFakeTimers();
    const user = buildUser();
    findByPkSpy.mockResolvedValue(user);
    const token = createToken(user);

    await getUserForJWT(token);
    vi.setSystemTime(Date.now() + 30_001);
    await getUserForJWT(token);

    expect(findByPkSpy).toHaveBeenCalledTimes(2);
  });

  it("does not collide different tokens for different users", async () => {
    const firstUser = buildUser();
    const secondUser = buildUser();
    findByPkSpy.mockImplementation(async (id: string) =>
      id === firstUser.id ? firstUser : secondUser
    );

    const [first, second] = await Promise.all([
      getUserForJWT(createToken(firstUser)),
      getUserForJWT(createToken(secondUser)),
    ]);

    expect(findByPkSpy).toHaveBeenCalledTimes(2);
    expect(first.user).toBe(firstUser);
    expect(second.user).toBe(secondUser);
  });

  it("does not cache transfer tokens so single-use semantics stay fresh", async () => {
    const user = buildUser();
    findByPkSpy.mockResolvedValue(user);
    const token = createToken(user, "transfer");

    await getUserForJWT(token);
    await getUserForJWT(token);

    expect(findByPkSpy).toHaveBeenCalledTimes(2);
  });

  it("throws for used transfer tokens based on fresh lastActiveAt", async () => {
    const user = buildUser();
    findByPkSpy.mockResolvedValue(user);
    const createdAt = new Date(Date.now() - 60_000);
    user.lastActiveAt = new Date();
    const token = createToken(user, "transfer", {
      createdAt: createdAt.toISOString(),
    });

    await expect(getUserForJWT(token)).rejects.toThrow(
      "Token has already been used"
    );
  });

  it("throws for suspended users and does not populate the cache", async () => {
    const user = buildUser({ suspendedAt: new Date() });
    findByPkSpy.mockResolvedValue(user);
    const token = createToken(user);

    await expect(getUserForJWT(token)).rejects.toThrow();
    await expect(getUserForJWT(token)).rejects.toThrow();

    expect(findByPkSpy).toHaveBeenCalledTimes(2);
  });

  it("throws when the user or team cannot be found and does not populate the cache", async () => {
    findByPkSpy.mockResolvedValue(null);
    const token = createToken(buildUser());

    await expect(getUserForJWT(token)).rejects.toThrow("Invalid token");
    await expect(getUserForJWT(token)).rejects.toThrow("Invalid token");

    expect(findByPkSpy).toHaveBeenCalledTimes(2);
  });

  it("throws for an invalid signature and does not populate the cache", async () => {
    const user = buildUser();
    findByPkSpy.mockResolvedValue(user);
    const token = JWT.sign(
      { id: user.id, type: "session" },
      "a-completely-different-secret",
      { algorithm: "HS256" }
    );

    await expect(getUserForJWT(token)).rejects.toThrow("Invalid token");
    expect(findByPkSpy).toHaveBeenCalledTimes(1);
  });

  it("enforces allowedTypes before consulting the database or cache", async () => {
    const user = buildUser();
    findByPkSpy.mockResolvedValue(user);
    const token = createToken(user, "collaboration");

    await expect(getUserForJWT(token)).rejects.toThrow("Invalid token");
    expect(findByPkSpy).not.toHaveBeenCalled();

    const result = await getUserForJWT(token, ["session", "collaboration"]);
    expect(result.user).toBe(user);
  });

  it("evicts the least recently used entry once the cache is full", async () => {
    const users = Array.from({ length: 1001 }, () => buildUser());
    const tokens = users.map((user) => createToken(user));
    findByPkSpy.mockImplementation(
      async (id: string) => users.find((user) => user.id === id) ?? null
    );

    for (const token of tokens) {
      await getUserForJWT(token);
    }
    expect(findByPkSpy).toHaveBeenCalledTimes(1001);

    // The oldest entry was evicted by the final insert, so it must be
    // refetched.
    await getUserForJWT(tokens[0]);
    expect(findByPkSpy).toHaveBeenCalledTimes(1002);

    // The most recent entry is still cached.
    await getUserForJWT(tokens[1000]);
    expect(findByPkSpy).toHaveBeenCalledTimes(1002);
  });
});
