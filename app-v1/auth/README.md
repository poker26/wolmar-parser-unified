# App v1 authentication

The v1 API uses an opaque session token in an `HttpOnly` cookie. Only SHA-256
hashes of session and CSRF tokens are stored in PostgreSQL.

Public registration is intentionally absent. After applying migrations, create
a closed-beta account without putting its password in command-line arguments:

```bash
APP_USER_EMAIL=owner@example.com \
APP_USER_PASSWORD='use-a-password-manager' \
APP_USER_DISPLAY_NAME='Owner' \
npm run user:create
```

Production cookies use the `__Host-` prefix, `Secure`, and `Path=/`. Mutating v1
requests must copy the value of the readable `__Host-wolmar_csrf` cookie to the
`X-CSRF-Token` header. The session cookie remains inaccessible to JavaScript.

Available endpoints:

- `POST /api/v1/auth/login`
- `POST /api/v1/auth/logout`
- `POST /api/v1/auth/logout-all`
- `GET /api/v1/me`

Legacy `/api/auth/*` routes remain unchanged during the transition.
