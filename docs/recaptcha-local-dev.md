# reCAPTCHA local development

The frontend supports a safe local-only bypass for reCAPTCHA.

## Production

On these hostnames, reCAPTCHA is always enabled, even if `VITE_ENABLE_RECAPTCHA=false` is accidentally set:

- `lejapon.ma`
- `www.lejapon.ma`

## Local development

On these hostnames, reCAPTCHA is bypassed automatically:

- `localhost`
- `127.0.0.1`

The browser console prints:

```text
reCAPTCHA bypass enabled for localhost
```

## Environment variable

```text
VITE_ENABLE_RECAPTCHA=true
```

Set to `false` only for non-production development hosts. The frontend never exposes secret keys; server verification still uses Supabase Edge Function secrets in production.
