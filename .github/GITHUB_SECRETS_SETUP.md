# GitHub Secrets Setup for tokitoki-vscode Release

This guide explains how to configure the GitHub repository secrets needed for automated releases.

## Secrets Required

### 1. VSCE_PAT (VS Code Marketplace)

**What it is:** Personal Access Token for VS Code Marketplace

**How to get it:**
1. Go to https://marketplace.visualstudio.com/manage/publishers
2. Select or create your publisher account
3. Click on the publisher name, then "Personal access tokens"
4. Create a new token with:
   - Scopes: `manage` (for publishing)
   - Expiration: 90 days (recommended) or longer
5. Copy the token value

**Where to put it:**
1. Go to your GitHub repository
2. Settings → Secrets and variables → Actions
3. Click "New repository secret"
4. Name: `VSCE_PAT`
5. Value: Paste the token
6. Click "Add secret"

---

### 2. OVSX_PAT (Open VSX)

**What it is:** Access Token for Open VSX registry (open-vsx.org)

**How to get it:**
1. Go to https://open-vsx.org
2. Sign in with your account (or create one)
3. Click on your profile → Settings
4. Navigate to "Access Tokens"
5. Click "Generate New Token"
6. Name: `tokitoki-vscode` (or any descriptive name)
7. Scopes: Select `publish`
8. Click "Generate"
9. Copy the token value immediately (it won't be shown again)

**Where to put it:**
1. Go to your GitHub repository
2. Settings → Secrets and variables → Actions
3. Click "New repository secret"
4. Name: `OVSX_PAT`
5. Value: Paste the token
6. Click "Add secret"

---

## Verification

After adding both secrets, verify they're configured:

1. Go to Settings → Secrets and variables → Actions
2. You should see both `VSCE_PAT` and `OVSX_PAT` listed
3. You can't view the values (they're encrypted), but you should see:
   - ✅ `VSCE_PAT` - Updated recently
   - ✅ `OVSX_PAT` - Updated recently

## Testing the Configuration

To test the setup without cutting a full release:

### Quick CI Test
Push to the `dev` branch with a test commit - this runs the `ci.yml` workflow which verifies builds work.

### Full Release Test
On a test branch, you can manually trigger the release workflow:

```bash
# Create a test tag (don't push to main yet)
git tag v0.1.0-test
git push origin v0.1.0-test

# GitHub Actions will run, but will fail when checking "main branch" requirement
# This still verifies the secrets are accessible
```

Then delete the test tag:
```bash
git tag -d v0.1.0-test
git push origin :v0.1.0-test
```

## Security Best Practices

### Tokens
- ✅ Store only in GitHub Secrets (encrypted)
- ✅ Never commit to code
- ✅ Rotate periodically (every 90 days recommended)
- ❌ Don't share the token values
- ❌ Don't put in `.env` files

### Scope Limitation
- `VSCE_PAT`: Should have only `manage` scope (not admin)
- `OVSX_PAT`: Should have only `publish` scope

### Revocation
If a token is compromised:

#### For VSCE_PAT:
1. https://marketplace.visualstudio.com/manage/publishers
2. Click your publisher
3. Find the token in "Personal access tokens"
4. Click "Revoke"
5. Create a new token
6. Update GitHub secret

#### For OVSX_PAT:
1. https://open-vsx.org
2. Settings → Access Tokens
3. Find the token and click "Delete"
4. Create a new token
5. Update GitHub secret

## Troubleshooting

### Secrets not working in workflow
- Verify secrets are spelled correctly in workflow file:
  - `secrets.VSCE_PAT` ✅
  - `secrets.OVSX_PAT` ✅
- Ensure secrets are defined in repository settings
- Secrets only work on the default branch (`main` in this case)

### Token expired
- VSCE_PAT and OVSX_PAT have expiration dates
- Regenerate new tokens and update GitHub secrets
- Create calendar reminders for token renewal (typically 90 days)

### Permission denied on publish
- Verify token scopes include `publish`
- Check publisher namespace is claimed
- Ensure version is higher than previously published versions

## Environment Variables in Workflow

The workflow file accesses secrets as:
```yaml
env:
  VSCE_PAT: ${{ secrets.VSCE_PAT }}
  OVSX_PAT: ${{ secrets.OVSX_PAT }}
```

These are only available during GitHub Actions execution and never logged.

## Related Documentation

- VS Code Marketplace Publishing: https://code.visualstudio.com/api/working-with-extensions/publishing-extension
- Open VSX Registry: https://github.com/eclipse/openvsx
- GitHub Secrets: https://docs.github.com/en/actions/security-guides/encrypted-secrets
