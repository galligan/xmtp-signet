# xmtp.fyi installer host

This tiny Worker exists to serve a stable public installer URL:

```text
https://xmtp.fyi/install.sh
```

The Worker proxies the repo-backed installer script from GitHub so the public
URL stays stable even if the repo layout or bootstrap story changes.

The installer supports both source installs (default) and prebuilt-binary
installs (`--binary`). The Worker itself is transport-only — it proxies
`scripts/install.sh` from `main` and does not serve binaries. Binary tarballs
(`xs-<target>.tar.gz` + `.sha256`) live at GitHub Releases:
`https://github.com/galligan/xmtp-signet/releases`. The installer fetches them
directly; no Worker change is required when a new release is cut.

## Expected URLs

- `/` - plain-text landing output with the install command
- `/install.sh` - current installer script
- `/install/v1.sh` - versioned alias for the same installer
- `/healthz` - liveness probe

## Post-merge deploy

From this repo:

```bash
cd apps/xmtp-fyi-install
npx wrangler deploy
```

The Wrangler config attaches the Worker to the apex custom domain:

```text
xmtp.fyi
```

## DNS and zone notes

- `xmtp.fyi` must already exist as an active Cloudflare zone
- the hostname used as a custom domain cannot already have a conflicting CNAME
- Cloudflare will provision the certificate for the custom domain

## Verification

After deploy:

```bash
curl -i https://xmtp.fyi/healthz
curl -i https://xmtp.fyi/install.sh
curl -fsSL https://xmtp.fyi/install.sh | sed -n '1,40p'
```
