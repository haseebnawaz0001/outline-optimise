import { faker } from "@faker-js/faker";
import { randomUUID } from "node:crypto";
import { Scope } from "@shared/types";
import {
  buildApiKey,
  buildOAuthAuthentication,
  buildUser,
  buildTeam,
} from "@server/test/factories";
import { getTestServer } from "@server/test/support";

const mockTeamInSessionId = randomUUID();

vi.mock("@server/utils/authentication", () => ({
  getSessionsInCookie() {
    return { [mockTeamInSessionId]: {} };
  },
}));

const server = getTestServer();

describe("#auth.info", () => {
  it("should return current authentication", async () => {
    const team = await buildTeam();
    const team2 = await buildTeam();
    const team3 = await buildTeam({
      id: mockTeamInSessionId,
    });

    const user = await buildUser({ teamId: team.id });
    await buildUser();
    await buildUser({
      teamId: team2.id,
      email: user.email,
    });
    const res = await server.post("/api/auth.info", user);
    const body = await res.json();
    expect(res.status).toEqual(200);

    const availableTeamIds = body.data.availableTeams.map(
      (t: { id: string }) => t.id
    );

    expect(availableTeamIds.length).toEqual(3);
    expect(availableTeamIds).toContain(team.id);
    expect(availableTeamIds).toContain(team2.id);
    expect(availableTeamIds).toContain(team3.id);
    expect(body.data.user.name).toBe(user.name);
    expect(body.data.team.name).toBe(team.name);
    expect(body.data.team.allowedDomains).toEqual([]);
  });

  it("should return a collaboration token for a session", async () => {
    const user = await buildUser();
    const res = await server.post("/api/auth.info", user);
    const body = await res.json();
    expect(res.status).toEqual(200);
    expect(body.data.collaborationToken).toBeTruthy();
  });

  it("should not return a collaboration token for an API key", async () => {
    const user = await buildUser();
    const key = await buildApiKey({ userId: user.id });
    const res = await server.post("/api/auth.info", {
      headers: {
        Authorization: `Bearer ${key.value}`,
      },
    });
    const body = await res.json();
    expect(res.status).toEqual(200);
    expect(body.data.collaborationToken).toBeUndefined();
  });

  it("should not return a collaboration token for an OAuth access token", async () => {
    const user = await buildUser();
    const authentication = await buildOAuthAuthentication({
      user,
      scope: [Scope.Read],
    });
    const res = await server.post("/api/auth.info", {
      headers: {
        Authorization: `Bearer ${authentication.accessToken}`,
      },
    });
    const body = await res.json();
    expect(res.status).toEqual(200);
    expect(body.data.collaborationToken).toBeUndefined();
  });

  it("should require the team to not be deleted", async () => {
    const team = await buildTeam();
    const user = await buildUser({ teamId: team.id });
    await team.destroy();
    const res = await server.post("/api/auth.info", user);
    expect(res.status).toEqual(401);
  });

  it("should require authentication", async () => {
    const res = await server.post("/api/auth.info");
    expect(res.status).toEqual(401);
  });
});

describe("#auth.delete", () => {
  it("should make the access token unusable", async () => {
    const user = await buildUser();
    const res = await server.post("/api/auth.delete", user);
    expect(res.status).toEqual(200);

    const res2 = await server.post("/api/auth.info", user);
    expect(res2.status).toEqual(401);
  });

  it("should require authentication", async () => {
    const res = await server.post("/api/auth.delete");
    expect(res.status).toEqual(401);
  });
});

describe("#auth.config", () => {
  it("should return no external providers and enable password sign-in", async () => {
    const res = await server.post("/api/auth.config");
    const body = await res.json();
    expect(res.status).toEqual(200);
    expect(body.data.providers).toEqual([]);
    expect(body.data.passwordSigninEnabled).toBe(true);
  });

  it("should return team details for team subdomain", async () => {
    const subdomain = faker.internet.domainWord();
    await buildTeam({
      guestSignin: false,
      subdomain,
    });
    const res = await server.post("/api/auth.config", {
      headers: {
        host: `${subdomain}.outline.dev`,
      },
    });
    const body = await res.json();
    expect(res.status).toEqual(200);
    expect(body.data.providers).toEqual([]);
    expect(body.data.passwordSigninEnabled).toBe(true);
    expect(body.data.hostname).toBe(`${subdomain}.outline.dev`);
  });

  it("should return team details for team custom domain", async () => {
    const domain = faker.internet.domainName();
    await buildTeam({
      guestSignin: false,
      domain,
    });
    const res = await server.post("/api/auth.config", {
      headers: {
        host: domain,
      },
    });
    const body = await res.json();
    expect(res.status).toEqual(200);
    expect(body.data.providers).toEqual([]);
    expect(body.data.passwordSigninEnabled).toBe(true);
    expect(body.data.hostname).toBe(domain);
  });
});
