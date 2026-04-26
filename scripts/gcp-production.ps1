param(
  [string]$ProjectId = "discount-494316",
  [string]$ShopifyAppUrl = "https://discount-app-437971048935.europe-north1.run.app",
  [string]$Region = "europe-north1",
  [string]$ServiceName = "discount-app",
  [string]$RepositoryName = "cloud-run-source-deploy",
  [string]$ImageName = "discount-app",
  [string]$ServiceAccountName = "discount-app-run",
  [string]$FirestoreCollection = "shopify_sessions",
  [string]$ShopifyApiKeySecretName = "shopify-api-key",
  [string]$ShopifyApiSecretSecretName = "shopify-api-secret",
  [string]$Scopes = "read_discounts,write_discounts,write_products,read_shipping,read_markets,write_metaobjects,write_metaobject_definitions",
  [int]$MaxInstances = 3,
  [int]$Concurrency = 1,
  [string]$Cpu = "0.5",
  [string]$Memory = "512Mi",
  [string]$Timeout = "60s",
  [string]$FirestoreLocation = "",
  [string]$ShopifyApiKeyFile = "",
  [string]$ShopifyApiSecretFile = "",
  [switch]$SkipDeploy
)

$ErrorActionPreference = "Stop"

function Run-Gcloud {
  param([string[]]$Arguments)
  Write-Host ("gcloud " + ($Arguments -join " "))
  & gcloud @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "gcloud command failed: $($Arguments -join ' ')"
  }
}

function Test-GcloudResource {
  param([string[]]$Arguments)
  $oldPreference = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    & gcloud @Arguments *> $null
    return $LASTEXITCODE -eq 0
  } finally {
    $ErrorActionPreference = $oldPreference
  }
}

function Ensure-SecretValue {
  param(
    [string]$SecretName,
    [string]$FilePath
  )

  if (-not (Test-GcloudResource @("secrets", "describe", $SecretName, "--project=$ProjectId"))) {
    Run-Gcloud @("secrets", "create", $SecretName, "--replication-policy=automatic", "--project=$ProjectId")
  }

  if ($FilePath) {
    Run-Gcloud @("secrets", "versions", "add", $SecretName, "--data-file=$FilePath", "--project=$ProjectId")
  } else {
    Write-Host "No file supplied for secret '$SecretName'. Existing versions, if any, are left unchanged."
  }
}

function Wait-ForServiceAccount {
  param([string]$Email)

  for ($i = 0; $i -lt 12; $i++) {
    if (Test-GcloudResource @("iam", "service-accounts", "describe", $Email, "--project=$ProjectId")) {
      return
    }

    Start-Sleep -Seconds 5
  }

  throw "Service account did not become readable in time: $Email"
}

$FirestoreDbLocation = if ($FirestoreLocation) { $FirestoreLocation } else { $Region }
$ServiceAccountEmail = "$ServiceAccountName@$ProjectId.iam.gserviceaccount.com"
$ImageUri = "$Region-docker.pkg.dev/$ProjectId/$RepositoryName/$ImageName"

Run-Gcloud @("config", "set", "project", $ProjectId)

Run-Gcloud @(
  "services", "enable",
  "run.googleapis.com",
  "cloudbuild.googleapis.com",
  "artifactregistry.googleapis.com",
  "secretmanager.googleapis.com",
  "firestore.googleapis.com"
)

if (-not (Test-GcloudResource @("iam", "service-accounts", "describe", $ServiceAccountEmail, "--project=$ProjectId"))) {
  Run-Gcloud @(
    "iam", "service-accounts", "create", $ServiceAccountName,
    "--display-name=Discount App Cloud Run",
    "--project=$ProjectId"
  )
}

Wait-ForServiceAccount -Email $ServiceAccountEmail

Run-Gcloud @(
  "projects", "add-iam-policy-binding", $ProjectId,
  "--member=serviceAccount:$ServiceAccountEmail",
  "--role=roles/datastore.user"
)

Run-Gcloud @(
  "projects", "add-iam-policy-binding", $ProjectId,
  "--member=serviceAccount:$ServiceAccountEmail",
  "--role=roles/secretmanager.secretAccessor"
)

if (-not (Test-GcloudResource @("artifacts", "repositories", "describe", $RepositoryName, "--location=$Region", "--project=$ProjectId"))) {
  Run-Gcloud @(
    "artifacts", "repositories", "create", $RepositoryName,
    "--repository-format=docker",
    "--location=$Region",
    "--description=Container images for the Discount app",
    "--project=$ProjectId"
  )
}

if (-not (Test-GcloudResource @("firestore", "databases", "describe", "--database=(default)", "--project=$ProjectId"))) {
  Run-Gcloud @(
    "firestore", "databases", "create",
    "--database=(default)",
    "--location=$FirestoreDbLocation",
    "--type=firestore-native",
    "--project=$ProjectId"
  )
}

Ensure-SecretValue -SecretName $ShopifyApiKeySecretName -FilePath $ShopifyApiKeyFile
Ensure-SecretValue -SecretName $ShopifyApiSecretSecretName -FilePath $ShopifyApiSecretFile

if (-not $SkipDeploy) {
  $Substitutions = @(
    "_SERVICE_NAME=$ServiceName",
    "_REGION=$Region",
    "_SERVICE_ACCOUNT=$ServiceAccountEmail",
    "_CONCURRENCY=$Concurrency",
    "_CPU=$Cpu",
    "_MEMORY=$Memory",
    "_TIMEOUT=$Timeout",
    "_MAX_INSTANCES=$MaxInstances",
    "_IMAGE_URI=$ImageUri",
    "_SHOPIFY_APP_URL=$ShopifyAppUrl",
    "_FIRESTORE_SESSION_COLLECTION=$FirestoreCollection",
    "_SCOPES=$Scopes",
    "_SHOPIFY_API_KEY_SECRET=$ShopifyApiKeySecretName",
    "_SHOPIFY_API_SECRET_SECRET=$ShopifyApiSecretSecretName"
  ) -join "|"

  Run-Gcloud @(
    "builds", "submit",
    "--config", "cloudbuild.yaml",
    "--substitutions=^|^$Substitutions"
  )
}

Write-Host ""
Write-Host "GCP production setup complete."
Write-Host "Service account: $ServiceAccountEmail"
Write-Host "Artifact Registry image: $ImageUri"
Write-Host "Firestore database: (default) in $FirestoreDbLocation"
Write-Host "Cloud Run URL must match Shopify application_url and redirect URLs."
