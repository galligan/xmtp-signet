const DEFAULT_REPO = "galligan/xmtp-signet";
const DEFAULT_REF = "main";

function installScriptUrl(env) {
  if (env.INSTALL_SCRIPT_URL) {
    return env.INSTALL_SCRIPT_URL;
  }

  const repo = env.GITHUB_REPO || DEFAULT_REPO;
  const ref = env.GITHUB_REF || DEFAULT_REF;
  return `https://raw.githubusercontent.com/${repo}/${ref}/scripts/install.sh`;
}

function installCommand() {
  return "curl -fsSL https://xmtp.fyi/install.sh | bash";
}

function textResponse(body, init = {}) {
  const headers = new Headers(init.headers);
  if (!headers.has("content-type")) {
    headers.set("content-type", "text/plain; charset=utf-8");
  }

  return new Response(body, {
    ...init,
    headers,
  });
}

async function proxyInstallScript(env) {
  const upstreamUrl = installScriptUrl(env);
  const upstream = await fetch(upstreamUrl, {
    headers: {
      "user-agent": "xmtp-signet-install-cli-worker",
    },
  });

  if (!upstream.ok) {
    return textResponse(
      `Failed to fetch upstream installer: ${upstream.status}\n`,
      {
        status: 502,
        headers: {
          "cache-control": "no-store",
          "x-install-upstream": upstreamUrl,
        },
      },
    );
  }

  const headers = new Headers(upstream.headers);
  headers.set("content-type", "text/x-shellscript; charset=utf-8");
  headers.set("cache-control", "public, max-age=300");
  headers.set("x-install-upstream", upstreamUrl);
  return new Response(upstream.body, {
    status: upstream.status,
    headers,
  });
}

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);

    if (pathname === "/healthz") {
      return textResponse("ok\n", {
        headers: {
          "cache-control": "no-store",
        },
      });
    }

    if (pathname === "/install.sh" || pathname === "/install/v1.sh") {
      return proxyInstallScript(env);
    }

    if (pathname === "/") {
      return textResponse(
        [
          "xmtp-signet installer",
          "",
          `Run: ${installCommand()}`,
          "",
          `Upstream: ${installScriptUrl(env)}`,
          "",
          "Health: /healthz",
        ].join("\n") + "\n",
        {
          headers: {
            "cache-control": "public, max-age=60",
          },
        },
      );
    }

    return textResponse("Not found\n", {
      status: 404,
      headers: {
        "cache-control": "no-store",
      },
    });
  },
};
