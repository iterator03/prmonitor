import { buildTestingEnvironment } from "../environment/testing/fake";
import { PullRequestReference } from "../github-api/api";
import { LoadedState, ref } from "../storage/loaded-state";
import {
  MuteConfiguration,
  NOTHING_MUTED,
} from "../storage/mute-configuration";
import { fakePullRequest } from "../testing/fake-pr";
import { Core } from "./core";

describe("Core", () => {
  it("loads correctly without token", async () => {
    const env = buildTestingEnvironment();
    const core = new Core(env);

    // No token stored.
    env.store.token.currentValue = null;

    // Other things are stored, they should be ignored.
    env.store.lastError.currentValue = "error";
    env.store.currentlyRefreshing.currentValue = true;
    env.store.lastCheck.currentValue = {
      userLogin: "fwouts",
      openPullRequests: [],
    };
    env.store.notifiedPullRequests.currentValue = ["a", "b", "c"];
    env.store.muteConfiguration.currentValue = {
      mutedPullRequests: [
        {
          repo: {
            owner: "zenclabs",
            name: "prmonitor",
          },
          number: 1,
          until: {
            kind: "next-update",
            mutedAtTimestamp: 123,
          },
        },
      ],
    };

    // Initialise.
    await core.load();

    expect(core.token).toBeNull();
    expect(core.lastError).toBeNull();
    expect(core.refreshing).toBe(false);
    expect(core.loadedState).toBeNull();
    expect(core.muteConfiguration).toEqual(NOTHING_MUTED);
    expect(core.notifiedPullRequestUrls.size).toBe(0);
  });

  it("loads with token", async () => {
    const env = buildTestingEnvironment();
    const core = new Core(env);

    // A valid token is stored.
    env.store.token.currentValue = "valid-token";

    // Other things are stored, they should be restored.
    const state = {
      userLogin: "fwouts",
      repos: [],
      openPullRequests: [],
    };
    const notifiedPullRequestUrls = ["a", "b", "c"];
    const muteConfiguration: MuteConfiguration = {
      mutedPullRequests: [
        {
          repo: {
            owner: "zenclabs",
            name: "prmonitor",
          },
          number: 1,
          until: {
            kind: "next-update",
            mutedAtTimestamp: 123,
          },
        },
      ],
    };
    env.store.lastError.currentValue = "error";
    env.store.currentlyRefreshing.currentValue = true;
    env.store.lastCheck.currentValue = state;
    env.store.notifiedPullRequests.currentValue = notifiedPullRequestUrls;
    env.store.muteConfiguration.currentValue = muteConfiguration;

    // Initialise.
    await core.load();

    expect(core.token).toEqual("valid-token");
    expect(core.lastError).toEqual("error");
    expect(core.refreshing).toBe(true);
    expect(core.loadedState).toEqual(state);
    expect(core.muteConfiguration).toEqual(muteConfiguration);
    expect(Array.from(core.notifiedPullRequestUrls)).toEqual(
      notifiedPullRequestUrls
    );
  });

  it("reloads when receiving a load message", () => {
    const env = buildTestingEnvironment();

    // Initialize the core.
    // TODO: Consider adding the listener in a separate init() method.
    new Core(env);
    expect(env.store.token.loadCount).toBe(0);

    env.messenger.trigger({
      kind: "reload",
    });
    expect(env.store.token.loadCount).toBe(1);
  });

  it("doesn't reload on non-reload message", () => {
    const env = buildTestingEnvironment();

    // Initialize the core.
    // TODO: Consider adding the listener in a separate init() method.
    new Core(env);
    expect(env.store.token.loadCount).toBe(0);

    env.messenger.trigger({
      kind: "refresh",
    });
    expect(env.store.token.loadCount).toBe(0);
  });

  it("opens the pull request when notification is clicked", () => {
    const env = buildTestingEnvironment();

    // Initialize the core.
    // TODO: Consider adding the listener in a separate init() method.
    new Core(env);

    env.notifier.simulateClick("http://some-pr");
    expect(env.tabOpener.openedUrls).toEqual(["http://some-pr"]);
  });

  it("opens the pull request when openPullRequest() is called", () => {
    const env = buildTestingEnvironment();

    // Initialize the core.
    const core = new Core(env);

    core.openPullRequest("http://some-pr");
    expect(env.tabOpener.openedUrls).toEqual(["http://some-pr"]);
  });

  it("resets state and triggers a refresh when a new token is set", async () => {
    const env = buildTestingEnvironment();
    const core = new Core(env);

    // A valid token is stored.
    env.store.token.currentValue = "token-fwouts";
    const state = {
      userLogin: "fwouts",
      repos: [],
      openPullRequests: [],
    };
    env.store.currentlyRefreshing.currentValue = true;
    env.store.lastCheck.currentValue = state;

    // Initialise.
    await core.load();
    expect(core.loadedState && core.loadedState.userLogin).toBe("fwouts");

    await core.setNewToken("token-kevin");
    expect(core.loadedState).toBeNull();
    expect(env.store.token.currentValue).toEqual("token-kevin");
    expect(env.store.lastError.currentValue).toEqual(null);
    expect(env.store.currentlyRefreshing.currentValue).toBe(false);
    expect(env.store.notifiedPullRequests.currentValue).toEqual([]);
    expect(env.store.lastCheck.currentValue).toEqual(null);
    expect(env.store.muteConfiguration.currentValue).toEqual(NOTHING_MUTED);
    expect(env.messenger.sent).toEqual([{ kind: "refresh" }]);
  });

  it("doesn't refresh when not authenticated", async () => {
    const env = buildTestingEnvironment();
    const core = new Core(env);
    env.store.token.currentValue = null;

    // Initialise.
    await core.load();
    expect(core.refreshing).toBe(false);

    // Refresh.
    await core.refreshPullRequests();

    expect(env.githubLoader).not.toHaveBeenCalled();
    expect(core.refreshing).toBe(false);
    expect(core.lastError).toBeNull();
  });

  it("doesn't refresh when offline", async () => {
    const env = buildTestingEnvironment();
    const core = new Core(env);
    env.store.token.currentValue = "valid-token";
    env.online = false;

    // Initialise.
    await core.load();
    expect(core.refreshing).toBe(false);

    // Refresh.
    await core.refreshPullRequests();

    expect(env.githubLoader).not.toHaveBeenCalled();
    expect(core.refreshing).toBe(false);
    expect(core.lastError).toBeNull();
  });

  test("successful refresh after no stored state updates badge", async () => {
    const env = buildTestingEnvironment();
    const core = new Core(env);
    env.store.token.currentValue = "valid-token";

    // Initialise.
    await core.load();
    expect(core.refreshing).toBe(false);
    expect(env.badger.updated).toEqual([
      {
        kind: "initializing",
      },
    ]);

    // Refresh.
    env.githubLoader.mockReturnValue(
      Promise.resolve<LoadedState>({
        userLogin: "fwouts",
        openPullRequests: [],
      })
    );
    await core.refreshPullRequests();

    expect(env.githubLoader).toHaveBeenCalled();
    expect(core.refreshing).toBe(false);
    expect(env.store.lastError.currentValue).toBeNull();
    expect(env.badger.updated).toEqual([
      {
        kind: "initializing",
      },
      {
        kind: "initializing",
      },
      {
        kind: "loaded",
        unreviewedPullRequestCount: 0,
      },
    ]);
    expect(env.messenger.sent).toEqual([
      { kind: "reload" },
      { kind: "reload" },
    ]);
  });

  test("successful refresh after a previous state updates badge", async () => {
    const env = buildTestingEnvironment();
    const core = new Core(env);
    env.store.lastCheck.currentValue = {
      userLogin: "fwouts",
      openPullRequests: [],
    };
    env.store.token.currentValue = "valid-token";

    // Initialise.
    await core.load();
    expect(core.refreshing).toBe(false);
    expect(env.badger.updated).toEqual([
      {
        kind: "loaded",
        unreviewedPullRequestCount: 0,
      },
    ]);

    // Refresh.
    env.githubLoader.mockReturnValue(
      Promise.resolve<LoadedState>({
        userLogin: "fwouts",
        openPullRequests: [],
      })
    );
    await core.refreshPullRequests();

    expect(env.githubLoader).toHaveBeenCalled();
    expect(core.refreshing).toBe(false);
    expect(env.store.lastError.currentValue).toBeNull();
    expect(env.badger.updated).toEqual([
      {
        kind: "loaded",
        unreviewedPullRequestCount: 0,
      },
      {
        kind: "reloading",
        unreviewedPullRequestCount: 0,
      },
      {
        kind: "loaded",
        unreviewedPullRequestCount: 0,
      },
    ]);
    expect(env.messenger.sent).toEqual([
      { kind: "reload" },
      { kind: "reload" },
    ]);
  });

  test("successful refresh after a previous error updates badge and clears error", async () => {
    const env = buildTestingEnvironment();
    const core = new Core(env);
    env.store.lastError.currentValue = "old error";
    env.store.token.currentValue = "valid-token";

    // Initialise.
    await core.load();
    expect(core.refreshing).toBe(false);
    expect(env.badger.updated).toEqual([
      {
        kind: "error",
      },
    ]);

    // Refresh.
    env.githubLoader.mockReturnValue(
      Promise.resolve<LoadedState>({
        userLogin: "fwouts",
        openPullRequests: [],
      })
    );
    await core.refreshPullRequests();

    expect(env.githubLoader).toHaveBeenCalled();
    expect(core.refreshing).toBe(false);
    expect(env.store.lastError.currentValue).toBeNull();
    expect(env.badger.updated).toEqual([
      {
        kind: "error",
      },
      {
        kind: "error",
      },
      {
        kind: "loaded",
        unreviewedPullRequestCount: 0,
      },
    ]);
    expect(env.messenger.sent).toEqual([
      { kind: "reload" },
      { kind: "reload" },
    ]);
  });

  test("failed refresh updates badge and error", async () => {
    const env = buildTestingEnvironment();
    const core = new Core(env);
    env.store.lastCheck.currentValue = {
      userLogin: "fwouts",
      openPullRequests: [],
    };
    env.store.token.currentValue = "valid-token";

    // Initialise.
    await core.load();
    expect(core.refreshing).toBe(false);
    expect(env.badger.updated).toEqual([
      {
        kind: "loaded",
        unreviewedPullRequestCount: 0,
      },
    ]);

    // Refresh.
    env.githubLoader.mockReturnValue(Promise.reject(new Error("Oh noes!")));
    await expect(core.refreshPullRequests()).rejects.toEqual(
      new Error("Oh noes!")
    );

    expect(env.githubLoader).toHaveBeenCalled();
    expect(core.refreshing).toBe(false);
    expect(env.store.lastError.currentValue).toEqual("Oh noes!");
    expect(env.badger.updated).toEqual([
      {
        kind: "loaded",
        unreviewedPullRequestCount: 0,
      },
      {
        kind: "reloading",
        unreviewedPullRequestCount: 0,
      },
      {
        kind: "error",
      },
    ]);
    expect(env.messenger.sent).toEqual([
      { kind: "reload" },
      { kind: "reload" },
    ]);
  });

  it("notifies of new pull requests and saves notified state", async () => {
    const env = buildTestingEnvironment();
    const core = new Core(env);
    env.store.token.currentValue = "valid-token";

    // Initialise.
    await core.load();
    expect(env.store.lastCheck.currentValue).toBeNull();

    // Refresh.
    env.githubLoader.mockReturnValue(
      Promise.resolve<LoadedState>({
        userLogin: "fwouts",
        openPullRequests: [
          fakePullRequest()
            .ref("zenclabs", "prmonitor", 1)
            .author("kevin")
            .seenAs("fwouts")
            .reviewRequested(["fwouts"])
            .build(),
        ],
      })
    );
    await core.refreshPullRequests();

    expect(
      env.store.lastCheck.currentValue &&
        env.store.lastCheck.currentValue.openPullRequests
    ).toHaveLength(1);
    expect(core.unreviewedPullRequests).toHaveLength(1);
    expect(env.notifier.notified).toEqual([
      ["http://github.com/zenclabs/prmonitor/1"],
    ]);
    expect(env.store.notifiedPullRequests.currentValue).toEqual([
      "http://github.com/zenclabs/prmonitor/1",
    ]);
  });

  it("updates badge after muting and unmuting a PR", async () => {
    const env = buildTestingEnvironment();
    const core = new Core(env);
    env.store.token.currentValue = "valid-token";
    const pr1 = fakePullRequest()
      .ref("zenclabs", "prmonitor", 1)
      .author("kevin")
      .seenAs("fwouts")
      .reviewRequested(["fwouts"])
      .build();
    const pr2 = fakePullRequest()
      .ref("zenclabs", "prmonitor", 2)
      .author("kevin")
      .seenAs("fwouts")
      .reviewRequested(["fwouts"])
      .build();
    env.store.lastCheck.currentValue = {
      userLogin: "fwouts",
      openPullRequests: [pr1, pr2],
    };

    // Initialise.
    await core.load();
    expect(env.badger.updated).toEqual([
      {
        kind: "loaded",
        unreviewedPullRequestCount: 2,
      },
    ]);

    // Mute the PR.
    await core.mutePullRequest(ref(pr1), "next-update");
    expect(env.badger.updated).toEqual([
      {
        kind: "loaded",
        unreviewedPullRequestCount: 2,
      },
      {
        kind: "loaded",
        unreviewedPullRequestCount: 1,
      },
    ]);

    // Unmute the PR.
    await core.unmutePullRequest(ref(pr1));
    expect(env.badger.updated).toEqual([
      {
        kind: "loaded",
        unreviewedPullRequestCount: 2,
      },
      {
        kind: "loaded",
        unreviewedPullRequestCount: 1,
      },
      {
        kind: "loaded",
        unreviewedPullRequestCount: 2,
      },
    ]);
  });

  it("doesn't duplicate muted pull requests", async () => {
    const env = buildTestingEnvironment();
    const core = new Core(env);
    await core.load();

    const pr1: PullRequestReference = {
      repo: {
        owner: "zenclabs",
        name: "prmonitor",
      },
      number: 1,
    };
    const pr2: PullRequestReference = {
      repo: {
        owner: "zenclabs",
        name: "prmonitor",
      },
      number: 2,
    };

    // Mute two PRs (on different dates).
    env.currentTime = 1;
    await core.mutePullRequest(pr1, "next-update");
    env.currentTime = 2;
    await core.mutePullRequest(pr2, "next-update");
    // Late on, mute the first PR again
    env.currentTime = 3;
    await core.mutePullRequest(pr1, "next-update");

    expect(core.muteConfiguration.mutedPullRequests).toHaveLength(2);
    expect(core.muteConfiguration.mutedPullRequests[0]).toEqual({
      ...pr2,
      until: {
        kind: "next-update",
        mutedAtTimestamp: 2,
      },
    });
    expect(core.muteConfiguration.mutedPullRequests[1]).toEqual({
      ...pr1,
      until: {
        kind: "next-update",
        mutedAtTimestamp: 3,
      },
    });
  });
});
