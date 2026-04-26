# GCP Production Runbook

This app is designed to run on Google Cloud with:

- Cloud Run for the app server
- Firestore for Shopify session storage
- Secret Manager for Shopify app secrets
- Artifact Registry for container images

## One-time setup

Run the PowerShell helper from the repo root:

```powershell
.\scripts\gcp-production.ps1 `
  -ShopifyApiKeyFile "C:\path\to\shopify-api-key.txt" `
  -ShopifyApiSecretFile "C:\path\to\shopify-api-secret.txt"
```

Current repo defaults already target:

- Project: `discount-494316`
- Region: `europe-north1`
- Service: `discount-app`
- Service account: `discount-app-run@discount-494316.iam.gserviceaccount.com`
- App URL: `https://discount-app-437971048935.europe-north1.run.app`

What it does:

1. Selects the GCP project.
2. Enables required APIs.
3. Creates the dedicated Cloud Run service account if missing.
4. Grants Firestore and Secret Manager access to that service account.
5. Creates the Artifact Registry Docker repository if missing.
6. Creates the Firestore database if missing.
7. Creates or updates the Shopify secrets in Secret Manager.
8. Runs `gcloud builds submit --config cloudbuild.yaml`.

## Safe dry run shape

If you want to prepare infra without deploying the app yet:

```powershell
.\scripts\gcp-production.ps1 `
  -SkipDeploy
```

## After deploy

Verify these items:

1. `gcloud run services describe discount-app --region=europe-north1`
2. Confirm `min instances = 0` and `max instances = 3`.
3. Confirm environment variables include `SESSION_STORAGE_BACKEND=firestore`.
4. Confirm the runtime service account is the dedicated app account, not the default compute account.
5. Open the Cloud Run URL and verify the Shopify app loads.
6. Install the production app on a test store and complete OAuth.
7. Check Firestore for documents in `shopify_sessions`.
8. Trigger webhook flows and confirm sessions remain valid.

## Shopify config alignment

The production Shopify config should match the same Cloud Run URL:

- `application_url = "https://discount-app-437971048935.europe-north1.run.app"`
- `redirect_urls = [ "https://discount-app-437971048935.europe-north1.run.app/auth/callback" ]`

## Cost controls

The repo defaults are intentionally conservative:

- `cpu=0.5`
- `memory=512Mi`
- `concurrency=1`
- `timeout=60s`
- `min-instances=0`
- `max-instances=3`
- request-based billing with CPU throttling

Only raise these if production traffic or webhook concurrency proves they are too tight.
