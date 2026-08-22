# Security

This document describes the controls the Service **actually has in place**. It is not a roadmap; everything below is implemented today.

## 1. We never hold your funds

- Your funds stay in **your own exchange account**. We have no deposit address, no wallet, and no keys to any wallet.
- Because of that, a compromise of our systems cannot move your funds. There is no mechanism to move them.

## 2. The API keys we ask for exclude withdrawal

- We request **read and trade** permissions only. We deliberately do **not** request withdrawal permission.
- A leaked key therefore cannot withdraw funds. When you create the key at your exchange, do not grant withdrawal.
- No employee of ours, at any privilege level, can withdraw your money.

## 3. API keys are stored encrypted

- Keys you connect are stored with envelope encryption. They are never written in plaintext.
- The plaintext key is not shown anywhere, including administrator screens.
- After saving a key we send one real request to the exchange to confirm it works. We do not mark a key "connected" on save alone.

## 4. Account security

- Passwords are stored as hashes. We do not store plaintext passwords.
- Two-factor authentication (TOTP) is supported, using the 6-digit code from your authenticator app.
- Sign-in attempts are rate limited. Repeated failures lock the account for a period.
- Session cookies are Secure and HttpOnly, and state-changing requests are checked against a CSRF token.
- Suspending an account revokes its sessions immediately.

## 5. Safeguards on the order path

- Orders are **re-validated on the server**; we do not trust values computed in the browser. Minimum quantity, tick and step size, price deviation, leverage cap, daily limits and open-position count are all checked server-side.
- A live order is transmitted only when every condition is satisfied. If any condition fails, nothing is sent and the reason is shown on screen.
- An emergency kill switch exists. When engaged, all live order transmission stops immediately.
- Administrators cannot place, modify or cancel orders on your behalf. That is by design, not a limitation.

## 6. Records and audit

- Administrator actions are written to an append-only audit log. Entries are not edited or deleted.
- Actions that are hard to reverse — suspension, role change, credential deletion — record a reason alongside the action.
- AI usage is recorded as counts and cost, but **prompt and response text is never stored.**

## 7. Transport protection

- The Service is served over HTTPS only. HSTS instructs browsers never to attempt plaintext connections.
- We set a Content Security Policy, X-Frame-Options: DENY (clickjacking), and X-Content-Type-Options: nosniff.

## 8. What we do not do

- We do not collect identity documents, selfies or proof of address. Verification is performed by your exchange, so there are no identity documents here to leak.
- We do not manage your funds and do not execute trades on your behalf automatically.
- We do not provide investment advice.

## 9. Reporting a vulnerability

If you find a security issue, please tell us. We will investigate, fix it, and report the outcome back to you.

Email: {{SUPPORT_EMAIL}}

Including the following helps us confirm the issue quickly:

1. Steps to reproduce
2. Impact (which data or which accounts are affected)
3. When you found it

## 10. Limits of this document

This document describes implemented controls. It is not a guarantee that no attack will succeed — complete security does not exist. We recommend that you also enable two-factor authentication on your exchange account and never grant withdrawal permission to an API key.
