# HSTS Preload — Setup and Verification

## Overview

HTTP Strict Transport Security (HSTS) forces browsers to use HTTPS for all requests
to the domain, preventing protocol-downgrade attacks and cookie hijacking.

The `preload` directive causes the domain to be included in browser preload lists
(baked into Chrome, Firefox, Safari, Edge) so HTTPS is enforced even on the very
first visit, before the browser has ever seen the HSTS header.

## Current Header

```
Strict-Transport-Security: max-age=63072000; includeSubDomains; preload
```

| Directive           | Value      | Meaning                                                  |
| ------------------- | ---------- | -------------------------------------------------------- |
| `max-age`           | `63072000` | 2 years in seconds — minimum required by hstspreload.org |
| `includeSubDomains` | present    | All subdomains are also forced to HTTPS                  |
| `preload`           | present    | Opt-in to browser preload lists                          |

Set in `next.config.mjs` → `async headers()`.

## Verification Steps

### 1. Staging Verification (do this first)

Before deploying to production, confirm the header is correct in staging:

```bash
curl -sI https://<staging-domain> | grep -i strict-transport
# Expected: strict-transport-security: max-age=63072000; includeSubDomains; preload
```

Also verify with [securityheaders.com](https://securityheaders.com/?q=<staging-domain>&followRedirects=on) — target an **A+** rating.

### 2. Production Header Check

```bash
curl -sI https://lumigift.app | grep -i strict-transport
```

### 3. Submit to Preload List

Once the production header is confirmed correct:

1. Go to **https://hstspreload.org/?domain=lumigift.app**
2. The site will validate that the header meets all requirements.
3. Click **Submit** to add the domain to the pending preload list.
4. Propagation to all browsers takes several months.

> **Warning**: Preloading is difficult to reverse. Only submit after you are confident
> that **all** subdomains are served over HTTPS (the `includeSubDomains` directive
> applies to every subdomain). To remove a domain from the list, visit
> https://hstspreload.org/removal/ — removal can take 6–12 months to propagate.

### 4. Monitor Preload Status

Check inclusion status at any time:

```bash
curl -s "https://hstspreload.org/api/v2/status?domain=lumigift.app"
```

## References

- [MDN: Strict-Transport-Security](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Strict-Transport-Security)
- [hstspreload.org](https://hstspreload.org)
- [securityheaders.com](https://securityheaders.com)
