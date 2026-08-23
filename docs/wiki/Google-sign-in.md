# Google sign-in

Optional. Without credentials the platform stays fully self-contained: password is the only path,
and the interface shows no Google button at all — the server decides, over
`GET /api/sign-in-options`, so an instance never displays a button that fails on click.

## Create the OAuth client

1. Google Cloud Console → **APIs & Services** → **Credentials**.
2. **Create credentials** → **OAuth client ID** → application type **Web application**.
3. Authorised redirect URI, exactly:

   ```
   https://your-domain/api/auth/callback/google
   ```

   For local development, add `http://localhost:3000/api/auth/callback/google`.
4. Copy the client ID and client secret.

The redirect URI must match character for character, including the scheme and any trailing path.
Google rejects mismatches with `redirect_uri_mismatch`, which is the single most common failure here.

## Configure the instance

```dotenv
GOOGLE_CLIENT_ID=xxxxxxxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=xxxxxxxx
```

Then restart the API. Two behaviours worth knowing:

- **Both or neither.** Setting only one is refused at startup, with the variable named and never its
  value. Half a configuration would mean a visible button that fails for everyone who clicks it.
- **Empty counts as absent.** `.env.example` ships these lines empty so you know they exist; copying
  the example verbatim must not stop the API from booting.

Verify without opening a browser:

```bash
curl -s https://your-domain/api/sign-in-options
# {"google":true}
```

## What users see

The password form stays first — it is the path that always exists. Google appears below it, after an
"or" separator, labelled the same in both modes because with Google, signing up and signing in are
the same gesture.

## Accounts and identity

Sign-in is handled by [better-auth](https://better-auth.com). A Google account creates a platform
account on first use; the transcriptions belong to that account. Nothing links a Google identity to a
worker: workers only ever see a media file and a model name.
