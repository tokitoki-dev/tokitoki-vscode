# Release Guide

This document describes how to release tokitoki-vscode to VS Code Marketplace and Open VSX.

## Automated Release (Recommended)

The release process is fully automated via GitHub Actions. Pushing a semver tag on `main` triggers the workflow:

```bash
# 1. Update version in package.json
npm version minor  # or major, patch

# 2. Push tag to main (requires main branch protection)
git push origin main --tags
```

This automatically:
1. ✅ Verifies tag and version match
2. ✅ Runs tests
3. ✅ Packages for all 6 platforms (darwin-arm64, darwin-x64, linux-x64, linux-arm64, win32-x64, win32-arm64)
4. ✅ Creates GitHub release with VSIXes
5. ✅ Publishes to VS Code Marketplace (requires `VSCE_PAT` secret)
6. ✅ Publishes to Open VSX (requires `OVSX_PAT` secret)

### GitHub Secrets Required

Configure these in your repository settings (Settings → Secrets and variables → Actions):

```
VSCE_PAT       VS Code Marketplace Personal Access Token
OVSX_PAT       Open VSX Access Token
```

## Manual Release

If automated release fails or you need manual control:

### 1. Build all platform VSIXes
```bash
make package-all
```

### 2. Publish to VS Code Marketplace
```bash
VSCE_PAT=your_token npx vsce publish --no-dependencies --packagePath tokitoki-vscode-*.vsix
```

### 3. Publish to Open VSX
```bash
OVSX_PAT=your_token npm run publish:open-vsx
```

Or manually for each platform:
```bash
OVSX_PAT=your_token ovsx publish tokitoki-vscode-darwin-arm64-0.1.5.vsix
```

## Release Checklist

Before pushing a release tag:

- [ ] Update `package.json` version
- [ ] Update `CHANGELOG.md` with release notes
- [ ] Run `npm test` to verify tests pass
- [ ] Run `make package-all` to verify builds succeed
- [ ] Commit and push to `dev` branch
- [ ] Create PR from `dev` to `main`
- [ ] Get code review and merge to `main`
- [ ] Create and push git tag: `git tag v0.1.5 && git push origin v0.1.5`

## Versioning

Follows semantic versioning (MAJOR.MINOR.PATCH):
- MAJOR: Breaking changes
- MINOR: New features
- PATCH: Bug fixes

Example: `v0.1.5`

## Rollback

If a release has issues:

1. Delete the git tag locally and on GitHub
2. Revert version in package.json
3. Delete the failed release from:
   - GitHub Releases
   - VS Code Marketplace (via publisher dashboard)
   - Open VSX (via admin panel)

## Troubleshooting

### VSCE_PAT is not configured
Set the VS Code Marketplace PAT in GitHub repository secrets.

### OVSX_PAT is not configured
Set the Open VSX token in GitHub repository secrets.

### Version mismatch error
Ensure `package.json` version matches git tag (without the 'v' prefix):
- Tag: `v0.1.5`
- package.json: `"version": "0.1.5"`

### VSIX not found
Ensure all 6 platform VSIX files are generated:
```bash
ls -1 tokitoki-vscode-*.vsix
# Should list 6 files (one per platform)
```

### Open VSX publish fails
- Verify OVSX_PAT token is correct and has `publish` permission
- Check that namespace is already claimed
- Wait 24 hours if rate limited

## Platform Support

Tokitoki-vscode is packaged for all these platforms:
- macOS: darwin-arm64 (M1/M2/M3), darwin-x64 (Intel)
- Linux: linux-x64, linux-arm64
- Windows: win32-x64, win32-arm64

Each user automatically gets the matching VSIX from both marketplaces.
