// TrueRate infrastructure — Azure, maximally managed, hobby-budget edition.
//
//   • Azure Cosmos DB (NoSQL, serverless)        data store, no servers/Redis
//   • Azure Container Apps (3 apps + 1 env)       serverless containers, scale-to-zero
//   • Azure Key Vault (RBAC)                      JWT secret + credential key
//   • User-assigned managed identity              KV read + Cosmos data
//   • Log Analytics (0.5 GB/day cap)              Container Apps logs, can't surprise-bill
//
// Container images live on GitHub Container Registry (ghcr.io, free) as public
// packages, not on ACR. This removes the ~€4.50/mo Basic-SKU ACR fixed cost.
// Auth to Cosmos and Key Vault is via the managed identity — no keys in app
// config. NOTE: validate locally before deploying:  az bicep build -f main.bicep
// (this file was authored without an az CLI available to compile it).

@description('Deployment location')
param location string = resourceGroup().location

@description('Short name prefix; lowercase letters/numbers only')
@minLength(3)
@maxLength(11)
param namePrefix string = 'truerate'

@description('Container image refs. Default to a public Microsoft sample for the very first deploy; CI replaces these with ghcr.io/<owner>/truerate-{api,mcp,web}:<sha> on every push.')
param apiImage string = 'mcr.microsoft.com/k8se/quickstart:latest'
param mcpImage string = 'mcr.microsoft.com/k8se/quickstart:latest'
param webImage string = 'mcr.microsoft.com/k8se/quickstart:latest'

@description('JWT signing secret (HS256). Provide at deploy time; stored in Key Vault.')
@secure()
param jwtSecret string

@description('AES-256 credential key, base64 of 32 bytes. Stored in Key Vault.')
@secure()
param credKey string

@description('Previous AES-256 credential key kept during rotation (<version-id>:<base64-32-bytes>). Empty = not set.')
@secure()
param credKeyPrev string = ''

@description('Shared admin-console secret (header x-admin-secret). Empty = admin console disabled (admin endpoints 401). Set the TRUERATE_ADMIN_SECRET GitHub secret to enable.')
@secure()
param adminSecret string = ''

@description('Stripe secret API key (sk_...). Empty = billing endpoints stay 501. Set STRIPE_SECRET_KEY GitHub secret to enable.')
@secure()
param stripeSecretKey string = ''

@description('Stripe webhook signing secret (whsec_...). Empty = /webhooks/stripe stays 501.')
@secure()
param stripeWebhookSecret string = ''

@description('Stripe recurring price ID (price_...) for the hotel subscription. Not secret.')
param stripePriceId string = ''

@description('Re-encryption job image. CI replaces this with ghcr.io/<owner>/truerate-reencrypt-job:<sha>.')
param reencryptJobImage string = 'mcr.microsoft.com/k8se/quickstart:latest'

var suffix = uniqueString(resourceGroup().id)
var kvName = take(toLower('${namePrefix}kv${suffix}'), 24)
var cosmosName = toLower('${namePrefix}-cosmos-${suffix}')
var laName = '${namePrefix}-logs'
var envName = '${namePrefix}-env'
var miName = '${namePrefix}-identity'
var credKeyPrevSecretName = 'cred-key-prev'

// ─── Managed identity ────────────────────────────────────────────────────────

resource mi 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: miName
  location: location
}

// ─── Container registry ──────────────────────────────────────────────────────
//
// Images live on ghcr.io as PUBLIC packages. Container Apps pull anonymously,
// so we need no registry credentials and no ACR. The deploy workflow handles
// pushing and flipping package visibility to public.

// ─── Key Vault (RBAC) ────────────────────────────────────────────────────────

resource kv 'Microsoft.KeyVault/vaults@2023-07-01' = {
  name: kvName
  location: location
  properties: {
    tenantId: subscription().tenantId
    sku: { family: 'A', name: 'standard' }
    enableRbacAuthorization: true
  }
}

resource jwtSecretRes 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: kv
  name: 'jwt-secret'
  properties: { value: jwtSecret }
}

resource credKeyRes 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: kv
  name: 'cred-key'
  properties: { value: credKey }
}

resource credKeyPrevRes 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = if (!empty(credKeyPrev)) {
  parent: kv
  name: 'cred-key-prev'
  properties: { value: credKeyPrev }
}

// Optional admin-console secret. Created only when adminSecret is supplied; when
// empty, no secret/env is wired and admin endpoints stay 401 (current behavior).
resource adminSecretRes 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = if (!empty(adminSecret)) {
  parent: kv
  name: 'admin-secret'
  properties: { value: adminSecret }
}

// Optional Stripe secrets — created only when supplied; empty = billing inert (501).
resource stripeSecretKeyRes 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = if (!empty(stripeSecretKey)) {
  parent: kv
  name: 'stripe-secret-key'
  properties: { value: stripeSecretKey }
}
resource stripeWebhookSecretRes 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = if (!empty(stripeWebhookSecret)) {
  parent: kv
  name: 'stripe-webhook-secret'
  properties: { value: stripeWebhookSecret }
}

// Key Vault Secrets User for the identity
resource kvSecretsUser 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(kv.id, mi.id, 'secrets-user')
  scope: kv
  properties: {
    principalId: mi.properties.principalId
    principalType: 'ServicePrincipal'
    // Key Vault Secrets User built-in role
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '4633458b-17de-408a-b874-0445c86b69e6')
  }
}

// ─── Cosmos DB (serverless, NoSQL) ───────────────────────────────────────────

resource cosmos 'Microsoft.DocumentDB/databaseAccounts@2024-05-15' = {
  name: cosmosName
  location: location
  kind: 'GlobalDocumentDB'
  properties: {
    databaseAccountOfferType: 'Standard'
    capabilities: [ { name: 'EnableServerless' } ]
    consistencyPolicy: { defaultConsistencyLevel: 'Session' }
    locations: [ { locationName: location, failoverPriority: 0 } ]
    disableLocalAuth: true // force AAD / managed identity, no account keys
  }
}

resource cosmosDb 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases@2024-05-15' = {
  parent: cosmos
  name: 'truerate'
  properties: { resource: { id: 'truerate' } }
}

resource usersContainer 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers@2024-05-15' = {
  parent: cosmosDb
  name: 'users'
  properties: {
    resource: {
      id: 'users'
      partitionKey: { paths: [ '/id' ], kind: 'Hash' }
    }
  }
}

// catalog container — versioned loyalty-program entries.
// Partition key: /programId (all versions of a program on one logical partition).
// Document id: "{programId}#v{version}" (unique; allows point reads by version).
// Composite indexes speed up the common (isCurrent, status) and
// (isCurrent, region) query patterns used by CatalogRepo.listPublished().
resource catalogContainer 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers@2024-05-15' = {
  parent: cosmosDb
  name: 'catalog'
  properties: {
    resource: {
      id: 'catalog'
      partitionKey: { paths: [ '/programId' ], kind: 'Hash' }
      indexingPolicy: {
        automatic: true
        includedPaths: [ { path: '/*' } ]
        excludedPaths: [ { path: '/"_etag"/?' } ]
        compositeIndexes: [
          [
            { path: '/isCurrent', order: 'ascending' }
            { path: '/status', order: 'ascending' }
          ]
          [
            { path: '/isCurrent', order: 'ascending' }
            { path: '/region', order: 'ascending' }
          ]
          [
            { path: '/programId', order: 'ascending' }
            { path: '/version', order: 'descending' }
          ]
        ]
      }
    }
  }
}

// usage container — provider/perk usage analytics events (#333).
// Partition key: /day (YYYY-MM-DD) so date-range aggregations touch few
// partitions. Default indexing covers the GROUP BY fields (programId, perkType,
// country, day). No prices are ever stored (issue #1).
resource usageContainer 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers@2024-05-15' = {
  parent: cosmosDb
  name: 'usage'
  properties: {
    resource: {
      id: 'usage'
      partitionKey: { paths: [ '/day' ], kind: 'Hash' }
    }
  }
}

// Cosmos built-in Data Contributor role for the identity (data-plane).
resource cosmosDataRole 'Microsoft.DocumentDB/databaseAccounts/sqlRoleAssignments@2024-05-15' = {
  parent: cosmos
  name: guid(cosmos.id, mi.id, 'data-contributor')
  properties: {
    principalId: mi.properties.principalId
    roleDefinitionId: '${cosmos.id}/sqlRoleDefinitions/00000000-0000-0000-0000-000000000002'
    scope: cosmos.id
  }
}

// ─── Logging + Container Apps environment ────────────────────────────────────

resource la 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: laName
  location: location
  // 0.5 GB/day daily cap → hard ceiling on log ingestion cost. PerGB2018 charges
  // ~€2.30/GB; this caps worst-case logs at ~€35/mo and in practice keeps a
  // hobby-traffic deployment inside the 5 GB/month free included quota.
  properties: {
    sku: { name: 'PerGB2018' }
    retentionInDays: 30
    workspaceCapping: { dailyQuotaGb: json('0.5') }
  }
}

resource env 'Microsoft.App/managedEnvironments@2024-03-01' = {
  name: envName
  location: location
  properties: {
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: la.properties.customerId
        sharedKey: la.listKeys().primarySharedKey
      }
    }
  }
}

// ─── Container Apps ──────────────────────────────────────────────────────────

var miConfig = {
  type: 'UserAssigned'
  userAssignedIdentities: { '${mi.id}': {} }
}
// ghcr.io packages are public → no registries / no auth needed at pull time.
var kvSecrets = [
  { name: 'jwt-secret', keyVaultUrl: jwtSecretRes.properties.secretUri, identity: mi.id }
  { name: 'cred-key', keyVaultUrl: credKeyRes.properties.secretUri, identity: mi.id }
]
// When credKeyPrev is supplied, add it as an additional KV-backed secret for the job.
var credKeyPrevSecretEntry = {
  name: credKeyPrevSecretName
  keyVaultUrl: empty(credKeyPrev) ? '' : credKeyPrevRes.properties.secretUri
  identity: mi.id
}
var jobSecrets = empty(credKeyPrev) ? kvSecrets : concat(kvSecrets, [credKeyPrevSecretEntry])
var cosmosEnv = [
  { name: 'COSMOS_ENDPOINT', value: cosmos.properties.documentEndpoint }
  { name: 'COSMOS_DATABASE', value: 'truerate' }
  { name: 'TRUERATE_INMEMORY', value: 'false' }
  // User-assigned MI: DefaultAzureCredential needs the client ID to pick which
  // identity to request a Cosmos token for. Without it the credential chain
  // falls through (→ azd CLI) and every Cosmos call throws
  // CredentialUnavailableError, crash-looping any container that hits Cosmos.
  { name: 'AZURE_CLIENT_ID', value: mi.properties.clientId }
]
var secretEnv = [
  { name: 'TRUERATE_JWT_SECRET', secretRef: 'jwt-secret' }
  { name: 'TRUERATE_CRED_KEY', secretRef: 'cred-key' }
]
var prevKeyEnv = empty(credKeyPrev)
  ? []
  : [{ name: 'TRUERATE_CRED_KEY_PREV', secretRef: credKeyPrevSecretName }]

// Optional admin secret wiring for the api + web containers (empty = no-op).
var adminSecretEntry = empty(adminSecret) ? [] : [{ name: 'admin-secret', keyVaultUrl: adminSecretRes.properties.secretUri, identity: mi.id }]
var adminEnv = empty(adminSecret) ? [] : [{ name: 'ADMIN_SECRET', secretRef: 'admin-secret' }]

// Optional Stripe billing wiring for the api (empty = endpoints stay 501).
var stripeSecretEntry = concat(
  empty(stripeSecretKey) ? [] : [{ name: 'stripe-secret-key', keyVaultUrl: stripeSecretKeyRes.properties.secretUri, identity: mi.id }],
  empty(stripeWebhookSecret) ? [] : [{ name: 'stripe-webhook-secret', keyVaultUrl: stripeWebhookSecretRes.properties.secretUri, identity: mi.id }]
)
var stripeEnv = concat(
  empty(stripeSecretKey) ? [] : [{ name: 'STRIPE_SECRET_KEY', secretRef: 'stripe-secret-key' }],
  empty(stripeWebhookSecret) ? [] : [{ name: 'STRIPE_WEBHOOK_SECRET', secretRef: 'stripe-webhook-secret' }],
  empty(stripePriceId) ? [] : [{ name: 'STRIPE_PRICE_ID', value: stripePriceId }]
)

resource api 'Microsoft.App/containerApps@2024-03-01' = {
  name: '${namePrefix}-api'
  location: location
  identity: miConfig
  properties: {
    managedEnvironmentId: env.id
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: { external: true, targetPort: 8787, transport: 'auto' }
      secrets: concat(kvSecrets, adminSecretEntry, stripeSecretEntry)
    }
    template: {
      containers: [
        {
          name: 'api'
          image: apiImage
          resources: { cpu: json('0.5'), memory: '1Gi' }
          env: concat(cosmosEnv, secretEnv, adminEnv, stripeEnv, [
            { name: 'API_PORT', value: '8787' }
            // Base URL of the MCP service, used to build each user's personal
            // MCP URL (https://<mcp>/u/<token>/mcp) — see issue #82.
            { name: 'MCP_PUBLIC_URL', value: 'https://${mcp.properties.configuration.ingress.fqdn}' }
            // CORS: the browser blocks the web app's API calls unless the API
            // echoes Access-Control-Allow-Origin for the web's origin. Without
            // this the deployed API defaulted to localhost only, so every UI
            // request (register, login, add-membership) silently failed in the
            // browser even though the server returned 200. The web FQDN is
            // stable per app name; web has no bicep dep on api, so this is acyclic.
            { name: 'CORS_ALLOWED_ORIGINS', value: 'https://${web.properties.configuration.ingress.fqdn},https://customrates.online,https://www.customrates.online' }
          ])
          probes: [
            {
              type: 'Startup'
              httpGet: { path: '/health', port: 8787, scheme: 'HTTP' }
              initialDelaySeconds: 0
              periodSeconds: 5
              failureThreshold: 24
              timeoutSeconds: 3
            }
            {
              type: 'Readiness'
              httpGet: { path: '/health', port: 8787, scheme: 'HTTP' }
              initialDelaySeconds: 0
              periodSeconds: 10
              failureThreshold: 3
              timeoutSeconds: 3
            }
            {
              type: 'Liveness'
              httpGet: { path: '/health', port: 8787, scheme: 'HTTP' }
              initialDelaySeconds: 30
              periodSeconds: 30
              failureThreshold: 3
              timeoutSeconds: 3
            }
          ]
        }
      ]
      scale: { minReplicas: 0, maxReplicas: 5 } // scale-to-zero: $0 when idle, cold-start on first request after idle
    }
  }
  dependsOn: [ kvSecretsUser, cosmosDataRole ]
}

resource mcp 'Microsoft.App/containerApps@2024-03-01' = {
  name: '${namePrefix}-mcp'
  location: location
  identity: miConfig
  properties: {
    managedEnvironmentId: env.id
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: { external: true, targetPort: 8788, transport: 'auto' }
      secrets: kvSecrets
    }
    template: {
      containers: [
        {
          name: 'mcp'
          image: mcpImage
          resources: { cpu: json('0.5'), memory: '1Gi' }
          env: concat(cosmosEnv, secretEnv, [ { name: 'MCP_PORT', value: '8788' } ])
          probes: [
            {
              type: 'Startup'
              httpGet: { path: '/health', port: 8788, scheme: 'HTTP' }
              initialDelaySeconds: 0
              periodSeconds: 5
              failureThreshold: 24
              timeoutSeconds: 3
            }
            {
              type: 'Readiness'
              httpGet: { path: '/health', port: 8788, scheme: 'HTTP' }
              initialDelaySeconds: 0
              periodSeconds: 10
              failureThreshold: 3
              timeoutSeconds: 3
            }
            {
              type: 'Liveness'
              httpGet: { path: '/health', port: 8788, scheme: 'HTTP' }
              initialDelaySeconds: 30
              periodSeconds: 30
              failureThreshold: 3
              timeoutSeconds: 3
            }
          ]
        }
      ]
      scale: { minReplicas: 0, maxReplicas: 5 } // scale-to-zero: $0 when idle, cold-start on first request after idle
    }
  }
  dependsOn: [ kvSecretsUser, cosmosDataRole ]
}

resource web 'Microsoft.App/containerApps@2024-03-01' = {
  name: '${namePrefix}-web'
  location: location
  identity: miConfig
  properties: {
    managedEnvironmentId: env.id
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: { external: true, targetPort: 3000, transport: 'auto' }
      secrets: adminSecretEntry
    }
    template: {
      containers: [
        {
          name: 'web'
          image: webImage
          resources: { cpu: json('0.5'), memory: '1Gi' }
          // NEXT_PUBLIC_* is baked at build time; set it as a build arg in CI.
          // ADMIN_SECRET (optional) lets the Next.js /api/admin/* proxy reach the
          // backend admin endpoints (e.g. the leaderboard). Empty = no admin env.
          env: adminEnv
          probes: [
            {
              type: 'Startup'
              httpGet: { path: '/api/health', port: 3000, scheme: 'HTTP' }
              initialDelaySeconds: 0
              periodSeconds: 5
              failureThreshold: 30
              timeoutSeconds: 3
            }
            {
              type: 'Readiness'
              httpGet: { path: '/api/health', port: 3000, scheme: 'HTTP' }
              initialDelaySeconds: 0
              periodSeconds: 10
              failureThreshold: 3
              timeoutSeconds: 3
            }
            {
              type: 'Liveness'
              httpGet: { path: '/api/health', port: 3000, scheme: 'HTTP' }
              initialDelaySeconds: 30
              periodSeconds: 30
              failureThreshold: 3
              timeoutSeconds: 3
            }
          ]
        }
      ]
      scale: { minReplicas: 0, maxReplicas: 5 } // scale-to-zero: $0 when idle, cold-start on first request after idle
    }
  }
  // Needs the KV-reader role when an admin-secret is wired (harmless otherwise).
  dependsOn: [ kvSecretsUser ]
}

// ─── Re-encryption Container Apps Job ───────────────────────────────────────
//
// Manually triggered; run during key rotation to migrate all encryptedCredential
// blobs from the previous key version to the active key version.
// Trigger with: az containerapp job start -n <job-name> -g <rg>
// Pass DRY_RUN=true to preview without writing:
//   az containerapp job start -n <job-name> -g <rg> \
//     --env-vars DRY_RUN=true

resource reencryptJob 'Microsoft.App/jobs@2024-03-01' = {
  name: '${namePrefix}-reencrypt-job'
  location: location
  identity: miConfig
  properties: {
    environmentId: env.id
    configuration: {
      triggerType: 'Manual'
      replicaTimeout: 1800 // 30-minute cap; a full user-table scan should finish in seconds
      replicaRetryLimit: 0 // fail fast; re-run manually after investigating errors
      manualTriggerConfig: {
        parallelism: 1
        replicaCompletionCount: 1
      }
      secrets: jobSecrets
    }
    template: {
      containers: [
        {
          name: 'reencrypt'
          image: reencryptJobImage
          resources: { cpu: json('0.5'), memory: '1Gi' }
          env: concat(cosmosEnv, [{ name: 'TRUERATE_CRED_KEY', secretRef: 'cred-key' }], prevKeyEnv)
        }
      ]
    }
  }
  dependsOn: [ kvSecretsUser, cosmosDataRole ]
}

output apiUrl string = 'https://${api.properties.configuration.ingress.fqdn}'
output mcpUrl string = 'https://${mcp.properties.configuration.ingress.fqdn}/mcp'
output webUrl string = 'https://${web.properties.configuration.ingress.fqdn}'
output identityClientId string = mi.properties.clientId
output cosmosEndpoint string = cosmos.properties.documentEndpoint
output reencryptJobName string = reencryptJob.name
