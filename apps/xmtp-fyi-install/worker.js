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

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
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

function htmlResponse(body, init = {}) {
  return textResponse(body, {
    ...init,
    headers: {
      ...init.headers,
      "content-type": "text/html; charset=utf-8",
    },
  });
}

function installLanding(env) {
  const command = installCommand();
  const sourceCommand = `${command} -s -- --source`;
  const upstreamUrl = installScriptUrl(env);
  const claudeCommands = `/plugin marketplace add galligan/xmtp-signet
/plugin install xmtp-signet@xmtp-signet`;
  const shellClaudeCommands = `claude plugin marketplace add galligan/xmtp-signet
claude plugin install xmtp-signet@xmtp-signet`;
  const skillsCommand = `git clone https://github.com/galligan/xmtp-signet.git
cd xmtp-signet
npx skills add ./.plugins/xmtp-signet \\
  --agent codex \\
  --agent openclaw \\
  --skill xmtp \\
  --skill xmtp-admin`;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Install xmtp-signet</title>
  <style>
    :root {
      color-scheme: light dark;
      --bg: #f7f5ef;
      --fg: #1c1a17;
      --muted: #6c645a;
      --panel: #ffffff;
      --border: #d8d0c3;
      --accent: #0f766e;
      --accent-strong: #0b5f59;
      --code-bg: #181713;
      --code-fg: #f8f4e8;
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --bg: #11100d;
        --fg: #f4efe4;
        --muted: #b9afa0;
        --panel: #1b1915;
        --border: #3a342c;
        --accent: #2dd4bf;
        --accent-strong: #5eead4;
        --code-bg: #050504;
        --code-fg: #f8f4e8;
      }
    }
    * {
      box-sizing: border-box;
    }
    body {
      margin: 0;
      min-height: 100vh;
      background: var(--bg);
      color: var(--fg);
      font: 16px/1.5 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    main {
      width: min(880px, calc(100% - 32px));
      margin: 0 auto;
      padding: 56px 0;
    }
    header {
      margin-bottom: 32px;
    }
    h1 {
      margin: 0 0 12px;
      font-size: clamp(2rem, 6vw, 4rem);
      line-height: 1;
      letter-spacing: 0;
    }
    h2 {
      margin: 0 0 12px;
      font-size: 1rem;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--accent);
    }
    p {
      margin: 0 0 16px;
      color: var(--muted);
      max-width: 68ch;
    }
    section {
      border-top: 1px solid var(--border);
      padding: 28px 0;
    }
    ol {
      margin: 0;
      padding-left: 1.5rem;
    }
    li {
      margin: 0 0 22px;
      padding-left: 0.25rem;
    }
    code {
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
      font-size: 0.95em;
    }
    pre {
      position: relative;
      margin: 10px 0 0;
      padding: 14px 104px 14px 16px;
      border-radius: 8px;
      overflow-x: auto;
      background: var(--code-bg);
      color: var(--code-fg);
      border: 1px solid var(--border);
    }
    a {
      color: var(--accent);
    }
    button {
      appearance: none;
      border: 1px solid color-mix(in srgb, var(--accent) 40%, transparent);
      border-radius: 999px;
      background: color-mix(in srgb, var(--accent) 14%, transparent);
      color: var(--accent-strong);
      cursor: pointer;
      font: 600 0.82rem/1 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    .copy {
      position: absolute;
      top: 10px;
      right: 10px;
      padding: 8px 12px;
    }
    .copy:focus-visible {
      outline: 2px solid var(--accent);
      outline-offset: 2px;
    }
    .note {
      padding: 14px 16px;
      border: 1px solid var(--border);
      border-radius: 8px;
      background: var(--panel);
    }
  </style>
</head>
<body>
  <main>
    <header>
      <h1>xmtp-signet</h1>
      <p>Install the <code>xs</code> command, then add the packaged skills so your agents know how to use the signet safely.</p>
    </header>

    <section>
      <h2>Install</h2>
      <ol>
        <li>
          Install the prebuilt binary.
          <pre><code>${escapeHtml(command)}</code><button class="copy" type="button" data-copy="${escapeHtml(command)}">Copy</button></pre>
        </li>
        <li>
          Restart your shell if the installer adds a new bin directory to your <code>PATH</code>, then check the command.
          <pre><code>xs --version</code><button class="copy" type="button" data-copy="xs --version">Copy</button></pre>
        </li>
        <li>
          Initialize the signet when you are ready to create local state.
          <pre><code>xs init
xs daemon start
xs status --json</code><button class="copy" type="button" data-copy="xs init&#10;xs daemon start&#10;xs status --json">Copy</button></pre>
        </li>
      </ol>
    </section>

    <section>
      <h2>Agent Skills</h2>
      <p>Install the bundled skills so Claude Code, Codex, OpenClaw, or other skill-aware agents can follow the signet model.</p>
      <pre><code>${escapeHtml(claudeCommands)}</code><button class="copy" type="button" data-copy="${escapeHtml(claudeCommands)}">Copy</button></pre>
      <p>From a shell with Claude Code installed:</p>
      <pre><code>${escapeHtml(shellClaudeCommands)}</code><button class="copy" type="button" data-copy="${escapeHtml(shellClaudeCommands)}">Copy</button></pre>
      <p>For other agents using <a href="https://skills.sh/">skills.sh</a>:</p>
      <pre><code>${escapeHtml(skillsCommand)}</code><button class="copy" type="button" data-copy="${escapeHtml(skillsCommand)}">Copy</button></pre>
    </section>

    <section>
      <h2>Options</h2>
      <p>Prefer a source checkout for development or an unsupported binary platform:</p>
      <pre><code>${escapeHtml(sourceCommand)}</code><button class="copy" type="button" data-copy="${escapeHtml(sourceCommand)}">Copy</button></pre>
      <p class="note">The script served at <a href="/install.sh">/install.sh</a> is proxied from <a href="${escapeHtml(upstreamUrl)}">the repository</a>. Review it before running if you want the long way around.</p>
    </section>
  </main>
  <script>
    async function copyText(text) {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
        return;
      }

      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.setAttribute("readonly", "");
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      const copied = document.execCommand("copy");
      textarea.remove();
      if (!copied) {
        throw new Error("Copy command failed");
      }
    }

    document.querySelectorAll("[data-copy]").forEach((button) => {
      button.addEventListener("click", async () => {
        const text = button.getAttribute("data-copy") || "";
        try {
          await copyText(text);
          button.textContent = "Copied";
          window.setTimeout(() => {
            button.textContent = "Copy";
          }, 1600);
        } catch {
          button.textContent = "Select";
        }
      });
    });
  </script>
</body>
</html>`;
}

async function proxyInstallScript(env) {
  const upstreamUrl = installScriptUrl(env);
  const upstream = await fetch(upstreamUrl, {
    headers: {
      "user-agent": "xmtp-fyi-install-worker",
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

    if (pathname === "/" || pathname === "/install") {
      return htmlResponse(installLanding(env), {
        headers: {
          "cache-control": "public, max-age=60",
        },
      });
    }

    return textResponse("Not found\n", {
      status: 404,
      headers: {
        "cache-control": "no-store",
      },
    });
  },
};
