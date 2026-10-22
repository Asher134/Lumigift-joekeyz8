# PWA & Offline Caching Strategy

Issue #349. Lumigift is installable as a Progressive Web App and keeps past gifts viewable on intermittent connections.

## Pieces

| File                                          | Purpose                                                                                       |
| --------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `src/app/manifest.ts`                         | Web App Manifest (`/manifest.webmanifest`): name, icons, `theme_color`, `display: standalone` |
| `src/app/icon.tsx`, `src/app/apple-icon.tsx`  | Generated 192/512 px and 180 px (iOS) PNG icons                                               |
| `public/sw.js`                                | Service worker                                                                                |
| `src/components/ui/ServiceWorkerRegister.tsx` | Registers `/sw.js` in production                                                              |
| `src/components/ui/OfflineBanner.tsx`         | Shown on dashboard and gift detail pages when offline                                         |

## Cache strategy

| Request                                      | Strategy                                             | Cache                |
| -------------------------------------------- | ---------------------------------------------------- | -------------------- |
| `GET /api/*` (except `/api/auth/*`)          | **Network-first**, fall back to last cached response | `lumigift-api-v1`    |
| Navigations to `/dashboard` and `/gifts/:id` | **Network-first**, fall back to cached page          | `lumigift-pages-v1`  |
| `/_next/static/*`, icons, fonts, images      | **Cache-first**                                      | `lumigift-assets-v1` |
| Non-GET requests (payments, claims)          | Never cached — always network                        | —                    |

Bump `VERSION` in `public/sw.js` to invalidate all caches; old caches are deleted on `activate`.

## Installability

- **Chrome / Android:** manifest + service worker with a fetch handler + 192/512 icons satisfy the install criteria.
- **Safari / iOS:** `appleWebApp` metadata and `apple-icon` enable "Add to Home Screen" in standalone mode.

The CSP allows `worker-src 'self'` and `manifest-src 'self'` (`src/proxy.ts`).
