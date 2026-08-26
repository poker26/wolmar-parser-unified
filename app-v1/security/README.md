# Security controls

`security_rate_limit` stores fixed-window counters under purpose-specific SHA-256
keys. Raw email, user UUID and IP address are never persisted. Counters work
across process restarts and multiple API instances and are removed after their
window expires.

`security_audit_event` stores only an allowlisted action and outcome, an optional
developer-controlled reason code, a server-generated request ID and a
purpose-specific actor pseudonym. Request paths, bodies, cookies, tokens, email,
IP addresses, user agents and object identifiers are not accepted by the writer.
Audit events expire after 400 days and are deleted with the corresponding user.
