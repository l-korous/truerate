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
]
var secretEnv = [
  { name: 'TRUERATE_JWT_SECRET', secretRef: 'jwt-secret' }
  { name: 'TRUERATE_CRED_KEY', secretRef: 'cred-key' }
]
var prevKeyEnv = empty(credKeyPrev)
  ? []
  : [{ name: 'TRUERATE_CRED_KEY_PREV', secretRef: credKeyPrevSecretName }]

resource api 'Microsoft.App/containerApps@2024-03-01' = {
  name: '${namePrefix}-api'
  location: location
  identity: miConfig
  properties: {
    managedEnvironmentId: env.id
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: { external: true, targetPort: 8787, transport: 'auto' }
      secrets: kvSecrets
    }
    template: {
      containers: [
        {
          name: 'api'
          image: apiImage
          resources: { cpu: json('0.5'), memory: '1Gi' }
          env: concat(cosmosEnv, secretEnv, [ { name: 'API_PORT', value: '8787' } ])
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
    }
    template: {
      containers: [
        {
          name: 'web'
          image: webImage
          resources: { cpu: json('0.5'), memory: '1Gi' }
          // NEXT_PUBLIC_* is baked at build time; set it as a build arg in CI.
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
